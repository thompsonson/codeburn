import { createWriteStream } from 'fs'
import { mkdir, readdir, stat } from 'fs/promises'
import { basename, dirname, join, resolve } from 'path'

import { readSessionLines } from './fs-utils.js'
import { discoverAllSessions } from './providers/index.js'
import {
  DENIAL_RE,
  SIBLING_CASCADE_RE,
  extractInlineCorrection,
  isToolResultBlock,
  toolResultText,
  truncateCorrectionText,
} from './tool-result-classifier.js'
import type {
  AssistantMessageContent,
  DateRange,
  JournalEntry,
  ToolUseBlock,
} from './types.js'

export type ToolEventRecord = {
  session_id: string
  timestamp: string
  project: string
  git_branch?: string
  model?: string
  event_type: 'tool_call' | 'tool_result' | 'denial' | 'correction'
  message_id?: string
  tool_use_id?: string
  tool_name?: string
  tool_input?: unknown
  is_error?: boolean
  error_category?: 'error' | 'sibling-cascade'
  error_message?: string
  denial_reason?: string
  correction_text?: string
  retry_index?: number
}

export type ExtractedToolEvent = ToolEventRecord & { lineNo: number; subIndex: number }

export type ExtractToolEventsContext = {
  sessionId: string
  project: string
}

function userMessageText(entry: JournalEntry): string {
  if (!entry.message || (entry.message as { role?: string }).role !== 'user') return ''
  const content = (entry.message as { content?: unknown }).content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((b): b is { type: 'text'; text: string } =>
      !!b && typeof b === 'object' && (b as { type?: unknown }).type === 'text' && typeof (b as { text?: unknown }).text === 'string'
    )
    .map(b => b.text)
    .join(' ')
}

function parseJsonlLine(line: string): JournalEntry | null {
  try {
    return JSON.parse(line) as JournalEntry
  } catch {
    return null
  }
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

function inDateRange(ts: string | undefined, range?: DateRange): boolean {
  if (!range) return true
  if (!ts) return false
  const t = new Date(ts)
  return t >= range.start && t <= range.end
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

function unsanitizePath(dirName: string): string {
  return dirName.replace(/-/g, '/')
}

export type ExportEventsOptions = {
  outputPath: string
  dateRange?: DateRange
  projectFilter?: string[]
  excludeFilter?: string[]
}

// Walk pre-parsed JSONL entries (with their source line numbers) and yield
// one ToolEventRecord per tool_call / tool_result / denial / correction.
// Stateful per-session: tracks tool_use_id -> name, retry-streak indices, and
// the open-denial pointer used to pair a denial with the next user free-text.
// Shared by exportEvents (writes JSONL) and the SQLite ingest pipeline.
export function* extractToolEventsFromEntries(
  ctx: ExtractToolEventsContext,
  entries: Iterable<{ lineNo: number; entry: JournalEntry }>,
): Generator<ExtractedToolEvent> {
  const toolNameById = new Map<string, string>()
  const sameToolStreak: { tool: string | null; index: number } = { tool: null, index: 0 }
  let pendingDenial:
    | { tool?: string; reason: string; messageId?: string }
    | null = null

  for (const { lineNo, entry } of entries) {
    const ts = entry.timestamp ?? ''
    const gitBranch = entry.gitBranch
    const project = ctx.project
    const sessionId = ctx.sessionId

    if (entry.type === 'assistant') {
      const msg = entry.message as AssistantMessageContent | undefined
      if (!msg) continue
      let subIndex = 0
      for (const b of msg.content ?? []) {
        if (b.type !== 'tool_use') continue
        const tu = b as ToolUseBlock
        if (tu.name !== sameToolStreak.tool) {
          sameToolStreak.tool = tu.name
          sameToolStreak.index = 0
        } else {
          sameToolStreak.index++
        }
        if (tu.id && tu.name) toolNameById.set(tu.id, tu.name)
        yield {
          lineNo,
          subIndex: subIndex++,
          session_id: sessionId,
          timestamp: ts,
          project,
          git_branch: gitBranch,
          model: msg.model,
          event_type: 'tool_call',
          message_id: entry.uuid,
          tool_use_id: tu.id,
          tool_name: tu.name,
          tool_input: tu.input ?? {},
          retry_index: sameToolStreak.index,
        }
      }
      continue
    }

    if (entry.type !== 'user' || !entry.message) continue
    const content = (entry.message as { content?: unknown }).content
    const parentMessageId = entry.parentUuid ?? undefined
    if (Array.isArray(content)) {
      let subIndex = 0
      for (const b of content) {
        if (!isToolResultBlock(b)) continue
        const text = toolResultText(b.content)
        const toolName = b.tool_use_id ? toolNameById.get(b.tool_use_id) : undefined
        if (DENIAL_RE.test(text)) {
          const inlineCorrection = extractInlineCorrection(text)
          yield {
            lineNo,
            subIndex: subIndex++,
            session_id: sessionId,
            timestamp: ts,
            project,
            git_branch: gitBranch,
            event_type: 'denial',
            message_id: parentMessageId,
            tool_use_id: b.tool_use_id,
            tool_name: toolName,
            denial_reason: text,
            correction_text: inlineCorrection ? truncateCorrectionText(inlineCorrection) : undefined,
          }
          pendingDenial = inlineCorrection
            ? null
            : { tool: toolName, reason: text, messageId: parentMessageId }
          continue
        }
        const isError = !!b.is_error
        const category: 'error' | 'sibling-cascade' | undefined = isError
          ? (SIBLING_CASCADE_RE.test(text) ? 'sibling-cascade' : 'error')
          : undefined
        yield {
          lineNo,
          subIndex: subIndex++,
          session_id: sessionId,
          timestamp: ts,
          project,
          git_branch: gitBranch,
          event_type: 'tool_result',
          message_id: parentMessageId,
          tool_use_id: b.tool_use_id,
          tool_name: toolName,
          is_error: isError,
          error_category: category,
          error_message: isError ? text : undefined,
        }
      }
      continue
    }

    const text = userMessageText(entry)
    if (text.trim() && pendingDenial) {
      yield {
        lineNo,
        subIndex: 0,
        session_id: sessionId,
        timestamp: ts,
        project,
        git_branch: gitBranch,
        event_type: 'correction',
        message_id: pendingDenial.messageId,
        tool_name: pendingDenial.tool,
        denial_reason: pendingDenial.reason,
        correction_text: truncateCorrectionText(text),
      }
      pendingDenial = null
    }
  }
}

export async function exportEvents(opts: ExportEventsOptions): Promise<{ path: string; eventCount: number; sessionCount: number }> {
  const target = resolve(opts.outputPath.toLowerCase().endsWith('.jsonl') ? opts.outputPath : `${opts.outputPath}.jsonl`)
  await mkdir(dirname(target), { recursive: true })

  const stream = createWriteStream(target, { encoding: 'utf-8' })
  let eventCount = 0
  const seenSessions = new Set<string>()

  const writeRecord = async (rec: ToolEventRecord) => {
    eventCount++
    if (!seenSessions.has(rec.session_id)) seenSessions.add(rec.session_id)
    if (!stream.write(JSON.stringify(rec) + '\n')) {
      // Wait for drain to bound memory on large dumps.
      await new Promise<void>(res => stream.once('drain', () => res()))
    }
  }

  const sources = await discoverAllSessions('claude')
  for (const source of sources) {
    if (!projectMatches(source.project, unsanitizePath(source.project), opts.projectFilter, opts.excludeFilter)) continue

    const files = await collectJsonlFiles(source.path)
    for (const filePath of files) {
      if (opts.dateRange) {
        const s = await stat(filePath).catch(() => null)
        if (s && s.mtimeMs < opts.dateRange.start.getTime()) continue
      }
      const sessionId = basename(filePath, '.jsonl')
      const numbered: { lineNo: number; entry: JournalEntry }[] = []
      let lineNo = 0
      for await (const line of readSessionLines(filePath)) {
        lineNo++
        const entry = parseJsonlLine(line)
        if (!entry) continue
        if (!inDateRange(entry.timestamp, opts.dateRange)) continue
        numbered.push({ lineNo, entry })
      }

      for (const ev of extractToolEventsFromEntries({ sessionId, project: source.project }, numbered)) {
        // Drop the storage-only line/sub-index fields when writing the JSONL stream.
        const { lineNo: _l, subIndex: _s, ...rec } = ev
        await writeRecord(rec)
      }
    }
  }

  await new Promise<void>((res, rej) => {
    stream.once('finish', () => res())
    stream.once('error', rej)
    stream.end()
  })

  return { path: target, eventCount, sessionCount: seenSessions.size }
}
