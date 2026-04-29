import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, cp, rm, readFile, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import { exportEvents, type ToolEventRecord } from '../src/event-export.js'

const FIXTURE_DAY = Date.UTC(2026, 3, 16)
const PROJECT_NAME = 'codeburn-event-export'

function makeRange() {
  return {
    start: new Date(FIXTURE_DAY - 24 * 60 * 60 * 1000),
    end: new Date(FIXTURE_DAY + 24 * 60 * 60 * 1000),
  }
}

describe('exportEvents', () => {
  let originalConfigDir: string | undefined
  let base: string
  let outputPath: string

  beforeEach(async () => {
    originalConfigDir = process.env['CLAUDE_CONFIG_DIR']
    base = await mkdtemp(join(tmpdir(), 'codeburn-events-'))
    const projectDir = join(base, 'projects', PROJECT_NAME)
    await mkdir(projectDir, { recursive: true })
    await cp(
      join(__dirname, 'fixtures', 'parser', 'tool-errors.jsonl'),
      join(projectDir, 'sess.jsonl'),
    )
    outputPath = join(base, 'events.jsonl')
    process.env['CLAUDE_CONFIG_DIR'] = base
  })

  afterEach(async () => {
    if (originalConfigDir === undefined) delete process.env['CLAUDE_CONFIG_DIR']
    else process.env['CLAUDE_CONFIG_DIR'] = originalConfigDir
    await rm(base, { recursive: true, force: true })
  })

  it('emits tool_call, tool_result, denial, and correction events', async () => {
    const result = await exportEvents({ outputPath, dateRange: makeRange() })
    expect(result.eventCount).toBeGreaterThan(0)
    const lines = (await readFile(outputPath, 'utf-8')).trim().split('\n')
    const events: ToolEventRecord[] = lines.map(l => JSON.parse(l))
    const types = events.map(e => e.event_type)
    expect(types).toContain('tool_call')
    expect(types).toContain('tool_result')
    expect(types).toContain('denial')
    const callTools = events.filter(e => e.event_type === 'tool_call').map(e => e.tool_name).sort()
    expect(callTools).toEqual(['Bash', 'Bash', 'Edit', 'Read'])
    const denial = events.find(e => e.event_type === 'denial')
    expect(denial?.tool_name).toBe('Edit')
    const cascade = events.find(e => e.event_type === 'tool_result' && e.error_category === 'sibling-cascade')
    expect(cascade).toBeDefined()
  })

  it('records retry_index for consecutive same-tool calls', async () => {
    await exportEvents({ outputPath, dateRange: makeRange() })
    const lines = (await readFile(outputPath, 'utf-8')).trim().split('\n')
    const calls = lines.map(l => JSON.parse(l) as ToolEventRecord).filter(e => e.event_type === 'tool_call')
    const bashCalls = calls.filter(c => c.tool_name === 'Bash')
    expect(bashCalls[0]?.retry_index).toBe(0)
    expect(bashCalls[1]?.retry_index).toBe(1)
    const readCall = calls.find(c => c.tool_name === 'Read')
    expect(readCall?.retry_index).toBe(0)
  })

  it('collects subagent JSONLs under <project>/<subdir>/subagents/', async () => {
    const subagentDir = join(base, 'projects', PROJECT_NAME, 'agent-1', 'subagents')
    await mkdir(subagentDir, { recursive: true })
    const subLine = JSON.stringify({
      type: 'assistant',
      sessionId: 'sub-sess',
      timestamp: '2026-04-16T00:01:00Z',
      message: {
        id: 'sub-msg',
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-4-6',
        content: [{ type: 'tool_use', id: 'sub-bash-1', name: 'Grep', input: { pattern: 'foo' } }],
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    })
    await writeFile(join(subagentDir, 'sub.jsonl'), subLine + '\n', 'utf-8')

    await exportEvents({ outputPath, dateRange: makeRange() })
    const lines = (await readFile(outputPath, 'utf-8')).trim().split('\n')
    const events: ToolEventRecord[] = lines.map(l => JSON.parse(l))
    const sessionIds = new Set(events.map(e => e.session_id))
    expect(sessionIds.has('sess')).toBe(true)
    expect(sessionIds.has('sub')).toBe(true)
    const grepCall = events.find(e => e.tool_name === 'Grep')
    expect(grepCall?.event_type).toBe('tool_call')
    expect(grepCall?.session_id).toBe('sub')
  })

  it('links tool_call and tool_result via message_id from assistant uuid', async () => {
    await exportEvents({ outputPath, dateRange: makeRange() })
    const lines = (await readFile(outputPath, 'utf-8')).trim().split('\n')
    const events: ToolEventRecord[] = lines.map(l => JSON.parse(l))
    const calls = events.filter(e => e.event_type === 'tool_call')
    const results = events.filter(e => e.event_type === 'tool_result' || e.event_type === 'denial')
    expect(calls.length).toBeGreaterThan(0)
    expect(results.length).toBeGreaterThan(0)
    for (const c of calls) expect(c.message_id).toBe('asst-msg-1')
    for (const r of results) expect(r.message_id).toBe('asst-msg-1')
  })

  it('pairs denial with following user correction text', async () => {
    const sessPath = join(base, 'projects', PROJECT_NAME, 'sess.jsonl')
    const original = await readFile(sessPath, 'utf-8')
    const correctionLine = JSON.stringify({
      type: 'user',
      sessionId: 'err-test',
      timestamp: '2026-04-16T00:00:05Z',
      message: { role: 'user', content: 'use sed instead' },
    })
    await writeFile(sessPath, original + correctionLine + '\n', 'utf-8')

    await exportEvents({ outputPath, dateRange: makeRange() })
    const lines = (await readFile(outputPath, 'utf-8')).trim().split('\n')
    const events: ToolEventRecord[] = lines.map(l => JSON.parse(l))
    const correction = events.find(e => e.event_type === 'correction')
    expect(correction?.correction_text).toBe('use sed instead')
    expect(correction?.tool_name).toBe('Edit')
  })

  it('extracts inline correction text from denial tool_result and skips next-message pairing', async () => {
    const sessPath = join(base, 'projects', PROJECT_NAME, 'sess.jsonl')
    const inlineDenial = JSON.stringify({
      type: 'assistant',
      sessionId: 'inline-test',
      uuid: 'asst-msg-2',
      timestamp: '2026-04-16T00:01:00Z',
      message: {
        id: 'msg-2',
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-4-6',
        content: [{ type: 'tool_use', id: 'tu-bash-99', name: 'Bash', input: { command: 'python script.py' } }],
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    })
    const inlineResult = JSON.stringify({
      type: 'user',
      sessionId: 'inline-test',
      uuid: 'user-res-99',
      parentUuid: 'asst-msg-2',
      timestamp: '2026-04-16T00:01:01Z',
      message: {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: 'tu-bash-99',
          is_error: true,
          content: [{ type: 'text', text: "The user doesn't want to proceed with this tool use. The tool use was rejected. To tell you how to proceed, the user said:\nuse uv run python instead of python" }],
        }],
      },
    })
    const followup = JSON.stringify({
      type: 'user',
      sessionId: 'inline-test',
      timestamp: '2026-04-16T00:01:02Z',
      message: { role: 'user', content: 'unrelated follow-up' },
    })
    const original = await readFile(sessPath, 'utf-8')
    await writeFile(sessPath, original + inlineDenial + '\n' + inlineResult + '\n' + followup + '\n', 'utf-8')

    await exportEvents({ outputPath, dateRange: makeRange() })
    const lines = (await readFile(outputPath, 'utf-8')).trim().split('\n')
    const events: ToolEventRecord[] = lines.map(l => JSON.parse(l))
    const denials = events.filter(e => e.event_type === 'denial' && e.tool_use_id === 'tu-bash-99')
    expect(denials.length).toBe(1)
    expect(denials[0]!.correction_text).toBe('use uv run python instead of python')
    expect(denials[0]!.tool_name).toBe('Bash')
    // Inline correction satisfies the issue's correction_text requirement; no
    // separate 'correction' event should be paired off the unrelated follow-up.
    const corrections = events.filter(e => e.event_type === 'correction' && e.tool_name === 'Bash')
    expect(corrections.length).toBe(0)
  })
})
