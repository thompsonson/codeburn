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
})
