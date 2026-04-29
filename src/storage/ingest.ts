import { hostname } from 'os'
import { readdir, stat } from 'fs/promises'
import { basename, join, sep } from 'path'

import { readSessionLines } from '../fs-utils.js'
import { extractToolEventsFromEntries, type ExtractedToolEvent } from '../event-export.js'
import { parseSessionEntries } from '../parser.js'
import { discoverAllSessions } from '../providers/index.js'
import type { JournalEntry, SessionSummary } from '../types.js'

import type { SqliteStore, ToolBreakdownRow, ToolEventRow } from './sqlite-store.js'

export type IngestOptions = {
  store: SqliteStore
  machineId: string
  providerFilter?: string
  projectFilter?: string[]
  excludeFilter?: string[]
  sinceMtimeMs?: number
}

export type IngestResult = {
  filesScanned: number
  filesSkippedUnchanged: number
  sessionsWritten: number
  eventsInserted: number
}

export function resolveMachineId(config?: { machineId?: string }): string {
  const fromConfig = config?.machineId?.trim()
  if (fromConfig) return fromConfig
  return hostname()
}

function unsanitizePath(dirName: string): string {
  return dirName.replace(/-/g, '/')
}

function projectMatches(project: string, projectPath: string, include?: string[], exclude?: string[]): boolean {
  const name = project.toLowerCase()
  const path = projectPath.toLowerCase()
  if (include && include.length > 0) {
    const ok = include.some(pat => {
      const p = pat.toLowerCase()
      return name.includes(p) || path.includes(p)
    })
    if (!ok) return false
  }
  if (exclude && exclude.length > 0) {
    const blocked = exclude.some(pat => {
      const p = pat.toLowerCase()
      return name.includes(p) || path.includes(p)
    })
    if (blocked) return false
  }
  return true
}

// Return the parent session id when the file lives under
// `<projectDir>/<parentSessionId>/subagents/<sessionId>.jsonl`.
function detectParentSessionId(filePath: string): string | undefined {
  const parts = filePath.split(sep)
  const idx = parts.indexOf('subagents')
  if (idx <= 0) return undefined
  return parts[idx - 1]
}

async function readEntriesWithLineNumbers(filePath: string): Promise<{ lineNo: number; entry: JournalEntry }[]> {
  const out: { lineNo: number; entry: JournalEntry }[] = []
  let lineNo = 0
  for await (const line of readSessionLines(filePath)) {
    lineNo++
    try {
      const entry = JSON.parse(line) as JournalEntry
      out.push({ lineNo, entry })
    } catch {
      // Skip unparseable lines; they were already invisible to the existing pipelines.
    }
  }
  return out
}

function toolBreakdownRows(summary: SessionSummary): ToolBreakdownRow[] {
  const rows: ToolBreakdownRow[] = []
  for (const [tool, stats] of Object.entries(summary.toolBreakdown)) {
    rows.push({
      tool,
      calls: stats.calls,
      errors: stats.errors ?? 0,
      denials: stats.denials ?? 0,
      siblingCascade: stats.siblingCascadeErrors ?? 0,
    })
  }
  return rows
}

function eventToRow(machineId: string, sessionId: string, ev: ExtractedToolEvent): ToolEventRow {
  return {
    machineId,
    sessionId,
    lineNo: ev.lineNo,
    subIndex: ev.subIndex,
    ts: ev.timestamp,
    eventType: ev.event_type,
    messageId: ev.message_id,
    toolUseId: ev.tool_use_id,
    toolName: ev.tool_name,
    toolInput: ev.tool_input === undefined ? undefined : JSON.stringify(ev.tool_input),
    isError: ev.is_error,
    errorCategory: ev.error_category,
    errorMessage: ev.error_message,
    denialReason: ev.denial_reason,
    correctionText: ev.correction_text,
    retryIndex: ev.retry_index,
    gitBranch: ev.git_branch,
    model: ev.model,
  }
}

async function ingestFile(
  filePath: string,
  source: { project: string; provider: string },
  store: SqliteStore,
  machineId: string,
  sinceMtimeMs: number | undefined,
  now: string,
): Promise<{ skipped: boolean; sessionWritten: boolean; eventsInserted: number }> {
  let info: { mtimeMs: number; size: number }
  try {
    const s = await stat(filePath)
    info = { mtimeMs: s.mtimeMs, size: s.size }
  } catch {
    return { skipped: true, sessionWritten: false, eventsInserted: 0 }
  }

  if (sinceMtimeMs !== undefined && info.mtimeMs < sinceMtimeMs) {
    return { skipped: true, sessionWritten: false, eventsInserted: 0 }
  }

  const cursor = store.getIngestState(machineId, filePath)
  if (cursor && cursor.mtimeMs === info.mtimeMs && cursor.sizeBytes === info.size) {
    return { skipped: true, sessionWritten: false, eventsInserted: 0 }
  }

  const truncated = cursor !== undefined && info.size < cursor.sizeBytes
  const skipBefore = cursor && !truncated ? cursor.lastLineNo : 0

  const numbered = await readEntriesWithLineNumbers(filePath)
  if (numbered.length === 0) {
    store.upsertIngestState({
      machineId,
      filePath,
      mtimeMs: info.mtimeMs,
      sizeBytes: info.size,
      lastLineNo: 0,
      lastIngestedAt: now,
    })
    return { skipped: false, sessionWritten: false, eventsInserted: 0 }
  }

  const sessionId = basename(filePath, '.jsonl')
  const parentSessionId = detectParentSessionId(filePath)
  const projectPath = unsanitizePath(source.project)
  const summary = parseSessionEntries(sessionId, source.project, numbered.map(n => n.entry))

  let eventsInserted = 0
  let sessionWritten = false

  store.transaction(() => {
    const hasSession = summary !== null && summary.apiCalls > 0
    if (hasSession) {
      store.upsertSession({
        machineId,
        sessionId,
        provider: source.provider,
        parentSessionId,
        project: source.project,
        projectPath,
        gitBranch: summary.gitBranch,
        firstTs: summary.firstTimestamp,
        lastTs: summary.lastTimestamp,
        costUsd: summary.totalCostUSD,
        apiCalls: summary.apiCalls,
        inputTokens: summary.totalInputTokens,
        outputTokens: summary.totalOutputTokens,
        cacheRead: summary.totalCacheReadTokens,
        cacheWrite: summary.totalCacheWriteTokens,
      })
      store.replaceToolBreakdown(machineId, sessionId, toolBreakdownRows(summary))
      store.replaceErrorPatterns(
        machineId,
        sessionId,
        (summary.errorPatterns ?? []).map(p => ({
          tool: p.tool,
          signature: p.signature,
          count: p.count,
          example: p.example,
        })),
      )
      sessionWritten = true

      for (const ev of extractToolEventsFromEntries({ sessionId, project: source.project }, numbered)) {
        if (ev.lineNo <= skipBefore) continue
        const r = store.insertEventOrIgnore(eventToRow(machineId, sessionId, ev))
        if (Number(r.changes) > 0) eventsInserted++
      }
    }

    const lastLineNo = numbered[numbered.length - 1]?.lineNo ?? 0
    store.upsertIngestState({
      machineId,
      filePath,
      mtimeMs: info.mtimeMs,
      sizeBytes: info.size,
      lastLineNo,
      lastIngestedAt: now,
    })
  })

  return { skipped: false, sessionWritten, eventsInserted }
}

async function collectJsonlFiles(dirPath: string): Promise<string[]> {
  const files = await readdir(dirPath).catch(() => [])
  const jsonlFiles = files.filter(f => f.endsWith('.jsonl')).map(f => join(dirPath, f))
  for (const entry of files) {
    if (entry.endsWith('.jsonl')) continue
    const subagentsPath = join(dirPath, entry, 'subagents')
    const subFiles = await readdir(subagentsPath).catch(() => [])
    for (const sf of subFiles) {
      if (sf.endsWith('.jsonl')) jsonlFiles.push(join(subagentsPath, sf))
    }
  }
  return jsonlFiles
}

export async function ingestClaudeSessions(opts: IngestOptions): Promise<IngestResult> {
  const sources = await discoverAllSessions(opts.providerFilter ?? 'claude')
  const claudeSources = sources.filter(s => s.provider === 'claude')

  const result: IngestResult = {
    filesScanned: 0,
    filesSkippedUnchanged: 0,
    sessionsWritten: 0,
    eventsInserted: 0,
  }
  const now = new Date().toISOString()

  for (const source of claudeSources) {
    if (!projectMatches(source.project, unsanitizePath(source.project), opts.projectFilter, opts.excludeFilter)) continue
    const files = await collectJsonlFiles(source.path)
    for (const filePath of files) {
      result.filesScanned++
      const r = await ingestFile(
        filePath,
        { project: source.project, provider: 'claude' },
        opts.store,
        opts.machineId,
        opts.sinceMtimeMs,
        now,
      )
      if (r.skipped) {
        result.filesSkippedUnchanged++
        continue
      }
      if (r.sessionWritten) result.sessionsWritten++
      result.eventsInserted += r.eventsInserted
    }
  }

  return result
}
