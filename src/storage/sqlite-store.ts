import { mkdir } from 'fs/promises'
import { dirname } from 'path'

import {
  openDatabaseWrite,
  type RunResult,
  type SqliteStatement,
  type WritableSqliteDatabase,
} from '../sqlite.js'
import { getCurrentVersion, runMigrations, targetVersion } from './migrations.js'

export type SessionRow = {
  machineId: string
  sessionId: string
  provider: string
  parentSessionId?: string
  project: string
  projectPath?: string
  gitBranch?: string
  firstTs: string
  lastTs: string
  costUsd: number
  apiCalls: number
  inputTokens: number
  outputTokens: number
  cacheRead: number
  cacheWrite: number
}

export type ToolBreakdownRow = {
  tool: string
  calls: number
  errors: number
  denials: number
  siblingCascade: number
}

export type ErrorPatternRow = {
  tool: string
  signature: string
  count: number
  example?: string
}

export type ToolEventRow = {
  machineId: string
  sessionId: string
  lineNo: number
  subIndex: number
  ts: string
  eventType: 'tool_call' | 'tool_result' | 'denial' | 'correction'
  messageId?: string
  toolUseId?: string
  toolName?: string
  toolInput?: string
  isError?: boolean
  errorCategory?: 'error' | 'sibling-cascade'
  errorMessage?: string
  denialReason?: string
  correctionText?: string
  retryIndex?: number
  gitBranch?: string
  model?: string
}

export type IngestStateRow = {
  machineId: string
  filePath: string
  mtimeMs: number
  sizeBytes: number
  lastLineNo: number
  lastIngestedAt: string
}

export type SqliteStore = {
  upsertSession(row: SessionRow): void
  insertEventOrIgnore(row: ToolEventRow): RunResult
  replaceToolBreakdown(machineId: string, sessionId: string, rows: ToolBreakdownRow[]): void
  replaceErrorPatterns(machineId: string, sessionId: string, rows: ErrorPatternRow[]): void
  upsertIngestState(row: IngestStateRow): void
  getIngestState(machineId: string, filePath: string): IngestStateRow | undefined
  userVersion(): number
  transaction<T>(fn: () => T): T
  raw(): WritableSqliteDatabase
  close(): void
}

const SESSION_UPSERT_SQL = `
INSERT INTO sessions (
  machine_id, session_id, provider, parent_session_id, project, project_path, git_branch,
  first_ts, last_ts, cost_usd, api_calls, input_tokens, output_tokens, cache_read, cache_write
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(machine_id, session_id) DO UPDATE SET
  provider = excluded.provider,
  parent_session_id = excluded.parent_session_id,
  project = excluded.project,
  project_path = excluded.project_path,
  git_branch = excluded.git_branch,
  first_ts = excluded.first_ts,
  last_ts = excluded.last_ts,
  cost_usd = excluded.cost_usd,
  api_calls = excluded.api_calls,
  input_tokens = excluded.input_tokens,
  output_tokens = excluded.output_tokens,
  cache_read = excluded.cache_read,
  cache_write = excluded.cache_write
`

const EVENT_INSERT_SQL = `
INSERT INTO tool_events (
  machine_id, session_id, line_no, sub_index, ts, event_type,
  message_id, tool_use_id, tool_name, tool_input,
  is_error, error_category, error_message, denial_reason, correction_text,
  retry_index, git_branch, model
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(machine_id, session_id, line_no, sub_index) DO NOTHING
`

const TOOL_BREAKDOWN_DELETE_SQL = `DELETE FROM tool_breakdown WHERE machine_id = ? AND session_id = ?`
const TOOL_BREAKDOWN_INSERT_SQL = `
INSERT INTO tool_breakdown (machine_id, session_id, tool, calls, errors, denials, sibling_cascade)
VALUES (?, ?, ?, ?, ?, ?, ?)
`

const ERROR_PATTERNS_DELETE_SQL = `DELETE FROM error_patterns WHERE machine_id = ? AND session_id = ?`
const ERROR_PATTERNS_INSERT_SQL = `
INSERT INTO error_patterns (machine_id, session_id, tool, signature, count, example)
VALUES (?, ?, ?, ?, ?, ?)
`

const INGEST_STATE_UPSERT_SQL = `
INSERT INTO ingest_state (machine_id, file_path, mtime_ms, size_bytes, last_line_no, last_ingested_at)
VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT(machine_id, file_path) DO UPDATE SET
  mtime_ms = excluded.mtime_ms,
  size_bytes = excluded.size_bytes,
  last_line_no = excluded.last_line_no,
  last_ingested_at = excluded.last_ingested_at
`

const INGEST_STATE_GET_SQL = `
SELECT machine_id, file_path, mtime_ms, size_bytes, last_line_no, last_ingested_at
FROM ingest_state WHERE machine_id = ? AND file_path = ?
`

type IngestStateDbRow = {
  machine_id: string
  file_path: string
  mtime_ms: number
  size_bytes: number
  last_line_no: number
  last_ingested_at: string
}

function boolToInt(v: boolean | undefined): number | null {
  return v === undefined ? null : v ? 1 : 0
}

function nullable<T>(v: T | undefined): T | null {
  return v === undefined ? null : v
}

export async function openStore(path: string): Promise<SqliteStore> {
  await mkdir(dirname(path), { recursive: true })
  const db = openDatabaseWrite(path)
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA journal_mode = WAL')

  const current = getCurrentVersion(db)
  const target = targetVersion()
  if (current > target) {
    db.close()
    throw new Error(
      `Database schema version ${current} is newer than this codeburn build (knows up to ${target}). Upgrade codeburn.`
    )
  }
  runMigrations(db)

  const sessionUpsert: SqliteStatement = db.prepare(SESSION_UPSERT_SQL)
  const eventInsert: SqliteStatement = db.prepare(EVENT_INSERT_SQL)
  const toolBreakdownDelete: SqliteStatement = db.prepare(TOOL_BREAKDOWN_DELETE_SQL)
  const toolBreakdownInsert: SqliteStatement = db.prepare(TOOL_BREAKDOWN_INSERT_SQL)
  const errorPatternsDelete: SqliteStatement = db.prepare(ERROR_PATTERNS_DELETE_SQL)
  const errorPatternsInsert: SqliteStatement = db.prepare(ERROR_PATTERNS_INSERT_SQL)
  const ingestStateUpsert: SqliteStatement = db.prepare(INGEST_STATE_UPSERT_SQL)
  const ingestStateGet: SqliteStatement = db.prepare(INGEST_STATE_GET_SQL)

  return {
    upsertSession(row) {
      sessionUpsert.run(
        row.machineId,
        row.sessionId,
        row.provider,
        nullable(row.parentSessionId),
        row.project,
        nullable(row.projectPath),
        nullable(row.gitBranch),
        row.firstTs,
        row.lastTs,
        row.costUsd,
        row.apiCalls,
        row.inputTokens,
        row.outputTokens,
        row.cacheRead,
        row.cacheWrite,
      )
    },
    insertEventOrIgnore(row): RunResult {
      return eventInsert.run(
        row.machineId,
        row.sessionId,
        row.lineNo,
        row.subIndex,
        row.ts,
        row.eventType,
        nullable(row.messageId),
        nullable(row.toolUseId),
        nullable(row.toolName),
        nullable(row.toolInput),
        boolToInt(row.isError),
        nullable(row.errorCategory),
        nullable(row.errorMessage),
        nullable(row.denialReason),
        nullable(row.correctionText),
        nullable(row.retryIndex),
        nullable(row.gitBranch),
        nullable(row.model),
      )
    },
    replaceToolBreakdown(machineId, sessionId, rows) {
      toolBreakdownDelete.run(machineId, sessionId)
      for (const r of rows) {
        toolBreakdownInsert.run(machineId, sessionId, r.tool, r.calls, r.errors, r.denials, r.siblingCascade)
      }
    },
    replaceErrorPatterns(machineId, sessionId, rows) {
      errorPatternsDelete.run(machineId, sessionId)
      for (const r of rows) {
        errorPatternsInsert.run(machineId, sessionId, r.tool, r.signature, r.count, nullable(r.example))
      }
    },
    upsertIngestState(row) {
      ingestStateUpsert.run(
        row.machineId,
        row.filePath,
        row.mtimeMs,
        row.sizeBytes,
        row.lastLineNo,
        row.lastIngestedAt,
      )
    },
    getIngestState(machineId, filePath) {
      const r = ingestStateGet.get<IngestStateDbRow>(machineId, filePath)
      if (!r) return undefined
      return {
        machineId: r.machine_id,
        filePath: r.file_path,
        mtimeMs: r.mtime_ms,
        sizeBytes: r.size_bytes,
        lastLineNo: r.last_line_no,
        lastIngestedAt: r.last_ingested_at,
      }
    },
    userVersion() {
      return getCurrentVersion(db)
    },
    transaction(fn) {
      return db.transaction(fn)
    },
    raw() {
      return db
    },
    close() {
      db.close()
    },
  }
}
