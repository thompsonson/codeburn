import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { appendFile, cp, mkdir, mkdtemp, rm, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import { ingestClaudeSessions, resolveMachineId } from '../../src/storage/ingest.js'
import { openStore, type SqliteStore } from '../../src/storage/sqlite-store.js'

const FIXTURE = join(__dirname, '..', 'fixtures', 'parser', 'tool-errors.jsonl')
const PROJECT = 'codeburn-ingest'
const MACHINE = 'test-host'

async function setupConfigDir(): Promise<{ base: string; projectDir: string }> {
  const base = await mkdtemp(join(tmpdir(), 'codeburn-ingest-'))
  const projectDir = join(base, 'projects', PROJECT)
  await mkdir(projectDir, { recursive: true })
  return { base, projectDir }
}

describe('resolveMachineId', () => {
  it('uses config machineId when present', () => {
    expect(resolveMachineId({ machineId: 'pinned-host' })).toBe('pinned-host')
  })

  it('trims whitespace', () => {
    expect(resolveMachineId({ machineId: '  pinned  ' })).toBe('pinned')
  })

  it('falls back to os.hostname() when blank', () => {
    expect(resolveMachineId({ machineId: '   ' })).not.toBe('')
    expect(resolveMachineId({})).not.toBe('')
    expect(resolveMachineId()).not.toBe('')
  })
})

describe('ingestClaudeSessions', () => {
  let originalConfigDir: string | undefined
  let base: string
  let projectDir: string
  let dbPath: string
  let store: SqliteStore

  beforeEach(async () => {
    originalConfigDir = process.env['CLAUDE_CONFIG_DIR']
    const setup = await setupConfigDir()
    base = setup.base
    projectDir = setup.projectDir
    process.env['CLAUDE_CONFIG_DIR'] = base
    dbPath = join(base, 'usage.db')
    store = await openStore(dbPath)
  })

  afterEach(async () => {
    store.close()
    if (originalConfigDir === undefined) delete process.env['CLAUDE_CONFIG_DIR']
    else process.env['CLAUDE_CONFIG_DIR'] = originalConfigDir
    await rm(base, { recursive: true, force: true })
  })

  it('ingests a session: writes session row, tool_breakdown, tool_events', async () => {
    await cp(FIXTURE, join(projectDir, 'sess.jsonl'))
    const result = await ingestClaudeSessions({ store, machineId: MACHINE })

    expect(result.filesScanned).toBe(1)
    expect(result.sessionsWritten).toBe(1)
    expect(result.eventsInserted).toBe(8) // 4 tool_calls + 3 tool_results + 1 denial

    const sessions = store.raw().query<{ session_id: string; api_calls: number; provider: string }>(
      'SELECT session_id, api_calls, provider FROM sessions'
    )
    expect(sessions).toHaveLength(1)
    expect(sessions[0].session_id).toBe('sess')
    expect(sessions[0].provider).toBe('claude')
    expect(sessions[0].api_calls).toBe(1)

    const events = store.raw().query<{ event_type: string; line_no: number; sub_index: number }>(
      'SELECT event_type, line_no, sub_index FROM tool_events ORDER BY line_no, sub_index'
    )
    expect(events).toHaveLength(8)
    expect(events.slice(0, 4).map(e => e.event_type)).toEqual([
      'tool_call', 'tool_call', 'tool_call', 'tool_call',
    ])
    expect(events.slice(0, 4).map(e => e.sub_index)).toEqual([0, 1, 2, 3])
    expect(events.find(e => e.event_type === 'denial')).toBeDefined()

    const tb = store.raw().query<{ tool: string; calls: number; errors: number; denials: number }>(
      'SELECT tool, calls, errors, denials FROM tool_breakdown ORDER BY tool'
    )
    expect(tb.find(r => r.tool === 'Bash')?.calls).toBe(2)
    expect(tb.find(r => r.tool === 'Edit')?.denials).toBe(1)
  })

  it('is idempotent: re-ingest of unchanged file inserts nothing new', async () => {
    await cp(FIXTURE, join(projectDir, 'sess.jsonl'))
    await ingestClaudeSessions({ store, machineId: MACHINE })

    const second = await ingestClaudeSessions({ store, machineId: MACHINE })
    expect(second.filesSkippedUnchanged).toBe(1)
    expect(second.eventsInserted).toBe(0)
    expect(second.sessionsWritten).toBe(0)

    const events = store.raw().query('SELECT COUNT(*) as n FROM tool_events') as Array<{ n: number }>
    expect(events[0].n).toBe(8)
  })

  it('resume cursor: appended lines produce only new events on re-ingest', async () => {
    const target = join(projectDir, 'sess.jsonl')
    await cp(FIXTURE, target)
    const first = await ingestClaudeSessions({ store, machineId: MACHINE })
    expect(first.eventsInserted).toBe(8)

    // Append a 6th line: another assistant message with one tool_use, after the
    // existing 5-line fixture. The mtime must change for the ingester to look
    // at the file again.
    await new Promise(r => setTimeout(r, 10))
    const extra = JSON.stringify({
      type: 'assistant',
      sessionId: 'err-test',
      uuid: 'asst-msg-2',
      timestamp: '2026-04-16T00:01:00Z',
      gitBranch: 'feat/errors',
      message: {
        id: 'msg-2',
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-4-6',
        content: [{ type: 'tool_use', id: 'tu-ls-1', name: 'LS', input: { path: '/' } }],
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    }) + '\n'
    await appendFile(target, extra)

    const second = await ingestClaudeSessions({ store, machineId: MACHINE })
    expect(second.eventsInserted).toBe(1)

    const events = store.raw().query<{ line_no: number; tool_name: string }>(
      'SELECT line_no, tool_name FROM tool_events WHERE line_no = 6'
    )
    expect(events).toHaveLength(1)
    expect(events[0].tool_name).toBe('LS')

    const total = store.raw().query('SELECT COUNT(*) as n FROM tool_events') as Array<{ n: number }>
    expect(total[0].n).toBe(9)
  })

  it('truncation detection: full re-walk dedupes via PK without losing data', async () => {
    const target = join(projectDir, 'sess.jsonl')
    await cp(FIXTURE, target)
    await ingestClaudeSessions({ store, machineId: MACHINE })

    // Truncate to a smaller version (re-write only first 3 lines), bumping mtime.
    await new Promise(r => setTimeout(r, 10))
    const fixtureContent = (await import('fs/promises')).readFile(FIXTURE, 'utf-8')
    const truncated = (await fixtureContent).split('\n').slice(0, 3).join('\n') + '\n'
    await writeFile(target, truncated)

    const second = await ingestClaudeSessions({ store, machineId: MACHINE })
    expect(second.filesSkippedUnchanged).toBe(0)
    // After truncation we walk all (3) remaining lines from line 1; the previously
    // inserted PKs for line 1 (4 tool_calls) and line 2 (1 tool_result) are
    // ignored. Line 3 brings 1 new tool_result that was already inserted on
    // first run, so insertEventOrIgnore is a no-op there too.
    expect(second.eventsInserted).toBe(0)

    const total = store.raw().query('SELECT COUNT(*) as n FROM tool_events') as Array<{ n: number }>
    // Original 8 events still present (we don't delete; PK is line_no based).
    expect(total[0].n).toBe(8)
  })

  it('subagent file is linked via parent_session_id', async () => {
    const subagentDir = join(projectDir, 'parent-uuid', 'subagents')
    await mkdir(subagentDir, { recursive: true })
    await cp(FIXTURE, join(subagentDir, 'sub-uuid.jsonl'))

    await ingestClaudeSessions({ store, machineId: MACHINE })

    const rows = store.raw().query<{ session_id: string; parent_session_id: string | null }>(
      'SELECT session_id, parent_session_id FROM sessions'
    )
    const sub = rows.find(r => r.session_id === 'sub-uuid')
    expect(sub).toBeDefined()
    expect(sub?.parent_session_id).toBe('parent-uuid')
  })

  it('honors providerFilter and projectFilter', async () => {
    await cp(FIXTURE, join(projectDir, 'sess.jsonl'))
    const otherProjectDir = join(base, 'projects', 'other-project')
    await mkdir(otherProjectDir, { recursive: true })
    await cp(FIXTURE, join(otherProjectDir, 'other.jsonl'))

    const result = await ingestClaudeSessions({
      store,
      machineId: MACHINE,
      projectFilter: ['ingest'],
    })
    expect(result.filesScanned).toBe(1) // only the project matching 'ingest'
    expect(result.sessionsWritten).toBe(1)
  })

  it('skips files older than sinceMtimeMs', async () => {
    const target = join(projectDir, 'sess.jsonl')
    await cp(FIXTURE, target)
    const s = await stat(target)

    const result = await ingestClaudeSessions({
      store,
      machineId: MACHINE,
      sinceMtimeMs: s.mtimeMs + 60_000,
    })
    expect(result.filesScanned).toBe(1)
    expect(result.filesSkippedUnchanged).toBe(1)
    expect(result.sessionsWritten).toBe(0)
  })
})
