import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import { openStore, type SessionRow, type ToolEventRow } from '../../src/storage/sqlite-store.js'

const MACHINE = 'host-a'
const SESSION = 'sess-1'

function makeSession(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    machineId: MACHINE,
    sessionId: SESSION,
    provider: 'claude',
    project: 'codeburn',
    firstTs: '2026-04-29T00:00:00Z',
    lastTs: '2026-04-29T01:00:00Z',
    costUsd: 1.23,
    apiCalls: 5,
    inputTokens: 100,
    outputTokens: 200,
    cacheRead: 50,
    cacheWrite: 25,
    ...overrides,
  }
}

function makeEvent(overrides: Partial<ToolEventRow> = {}): ToolEventRow {
  return {
    machineId: MACHINE,
    sessionId: SESSION,
    lineNo: 1,
    subIndex: 0,
    ts: '2026-04-29T00:00:00Z',
    eventType: 'tool_call',
    toolName: 'Read',
    toolUseId: 'tu_1',
    ...overrides,
  }
}

describe('sqlite-store', () => {
  let base: string

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'codeburn-store-'))
  })

  afterEach(async () => {
    await rm(base, { recursive: true, force: true })
  })

  it('upserts session row, replacing on second write', async () => {
    const store = await openStore(join(base, 'usage.db'))
    store.upsertSession(makeSession())
    store.upsertSession(makeSession({ costUsd: 9.99, apiCalls: 42 }))

    const rows = store.raw().query<{ cost_usd: number; api_calls: number }>(
      'SELECT cost_usd, api_calls FROM sessions WHERE machine_id = ? AND session_id = ?',
      [MACHINE, SESSION]
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].cost_usd).toBe(9.99)
    expect(rows[0].api_calls).toBe(42)
    store.close()
  })

  it('insertEventOrIgnore is no-op on duplicate PK', async () => {
    const store = await openStore(join(base, 'usage.db'))
    store.upsertSession(makeSession())
    store.insertEventOrIgnore(makeEvent({ toolName: 'Read' }))
    store.insertEventOrIgnore(makeEvent({ toolName: 'Edit' })) // same PK, different name

    const rows = store.raw().query<{ tool_name: string }>(
      'SELECT tool_name FROM tool_events WHERE machine_id = ? AND session_id = ?',
      [MACHINE, SESSION]
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].tool_name).toBe('Read')
    store.close()
  })

  it('insertEventOrIgnore allows distinct sub_index on same line', async () => {
    const store = await openStore(join(base, 'usage.db'))
    store.upsertSession(makeSession())
    store.insertEventOrIgnore(makeEvent({ subIndex: 0, toolUseId: 'a' }))
    store.insertEventOrIgnore(makeEvent({ subIndex: 1, toolUseId: 'b' }))

    const rows = store.raw().query<{ sub_index: number }>(
      'SELECT sub_index FROM tool_events ORDER BY sub_index'
    )
    expect(rows.map(r => r.sub_index)).toEqual([0, 1])
    store.close()
  })

  it('replaceToolBreakdown deletes prior rows for session', async () => {
    const store = await openStore(join(base, 'usage.db'))
    store.upsertSession(makeSession())
    store.replaceToolBreakdown(MACHINE, SESSION, [
      { tool: 'Read', calls: 10, errors: 0, denials: 0, siblingCascade: 0 },
      { tool: 'Edit', calls: 5, errors: 1, denials: 0, siblingCascade: 0 },
    ])
    store.replaceToolBreakdown(MACHINE, SESSION, [
      { tool: 'Read', calls: 11, errors: 0, denials: 0, siblingCascade: 0 },
    ])

    const rows = store.raw().query<{ tool: string; calls: number }>(
      'SELECT tool, calls FROM tool_breakdown WHERE machine_id = ? AND session_id = ?',
      [MACHINE, SESSION]
    )
    expect(rows).toEqual([{ tool: 'Read', calls: 11 }])
    store.close()
  })

  it('replaceErrorPatterns deletes prior rows for session', async () => {
    const store = await openStore(join(base, 'usage.db'))
    store.upsertSession(makeSession())
    store.replaceErrorPatterns(MACHINE, SESSION, [
      { tool: 'Bash', signature: 'Bash | ENOENT <path>', count: 3, example: 'ENOENT /tmp/x' },
    ])
    store.replaceErrorPatterns(MACHINE, SESSION, [])

    const rows = store.raw().query(
      'SELECT * FROM error_patterns WHERE machine_id = ? AND session_id = ?',
      [MACHINE, SESSION]
    )
    expect(rows).toHaveLength(0)
    store.close()
  })

  it('upsertIngestState round-trips via getIngestState', async () => {
    const store = await openStore(join(base, 'usage.db'))
    expect(store.getIngestState(MACHINE, '/tmp/sess.jsonl')).toBeUndefined()

    store.upsertIngestState({
      machineId: MACHINE,
      filePath: '/tmp/sess.jsonl',
      mtimeMs: 1_700_000_000_000,
      sizeBytes: 4096,
      lastLineNo: 100,
      lastIngestedAt: '2026-04-29T00:00:00Z',
    })
    const got = store.getIngestState(MACHINE, '/tmp/sess.jsonl')
    expect(got).toEqual({
      machineId: MACHINE,
      filePath: '/tmp/sess.jsonl',
      mtimeMs: 1_700_000_000_000,
      sizeBytes: 4096,
      lastLineNo: 100,
      lastIngestedAt: '2026-04-29T00:00:00Z',
    })

    store.upsertIngestState({
      machineId: MACHINE,
      filePath: '/tmp/sess.jsonl',
      mtimeMs: 1_700_000_001_000,
      sizeBytes: 8192,
      lastLineNo: 200,
      lastIngestedAt: '2026-04-29T01:00:00Z',
    })
    expect(store.getIngestState(MACHINE, '/tmp/sess.jsonl')?.lastLineNo).toBe(200)
    store.close()
  })

  it('foreign key cascade deletes child rows when session removed', async () => {
    const store = await openStore(join(base, 'usage.db'))
    store.upsertSession(makeSession())
    store.insertEventOrIgnore(makeEvent())
    store.replaceToolBreakdown(MACHINE, SESSION, [
      { tool: 'Read', calls: 1, errors: 0, denials: 0, siblingCascade: 0 },
    ])

    store.raw().run('DELETE FROM sessions WHERE machine_id = ? AND session_id = ?', [MACHINE, SESSION])

    expect(store.raw().query('SELECT * FROM tool_events')).toHaveLength(0)
    expect(store.raw().query('SELECT * FROM tool_breakdown')).toHaveLength(0)
    store.close()
  })

  it('refuses to open DB with newer schema version', async () => {
    const path = join(base, 'usage.db')
    const a = await openStore(path)
    a.raw().exec('PRAGMA user_version = 9999')
    a.close()

    await expect(openStore(path)).rejects.toThrow(/newer than this codeburn build/)
  })
})
