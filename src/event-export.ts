import { createWriteStream } from 'fs'
import { mkdir, readdir, stat } from 'fs/promises'
import { basename, dirname, join, resolve } from 'path'

import { readSessionLines } from './fs-utils.js'
import { discoverAllSessions } from './providers/index.js'
import type {
  AssistantMessageContent,
  ContentBlock,
  DateRange,
  JournalEntry,
  ToolUseBlock,
} from './types.js'

const SIBLING_CASCADE_RE = /sibling tool call errored/i
const DENIAL_RE = /(permission denied|doesn['’]t want to proceed|is not allowed by user|tool use was rejected|user rejected the tool call|user (?:has )?denied|tool denied)/i

export type ToolEventRecord = {
  session_id: string
  timestamp: string
  project: string
  git_branch?: string
  model?: string
  event_type: 'tool_call' | 'tool_result' | 'denial' | 'correction'
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

type ToolResultBlock = {
  type: 'tool_result'
  tool_use_id?: string
  is_error?: boolean
  content?: unknown
}

function isToolResultBlock(b: unknown): b is ToolResultBlock {
  return !!b && typeof b === 'object' && (b as { type?: unknown }).type === 'tool_result'
}

function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((b): b is { type: 'text'; text: string } =>
        !!b && typeof b === 'object' && (b as { type?: unknown }).type === 'text' && typeof (b as { text?: unknown }).text === 'string'
      )
      .map(b => b.text)
      .join('\n')
  }
  return ''
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
      const toolNameById = new Map<string, string>()
      const sameToolStreak: { tool: string | null; index: number } = { tool: null, index: 0 }
      let pendingDenial: { sessionId: string; project: string; gitBranch?: string; timestamp: string; tool?: string; reason: string } | null = null

      for await (const line of readSessionLines(filePath)) {
        const entry = parseJsonlLine(line)
        if (!entry) continue
        const ts = entry.timestamp ?? ''
        if (!inDateRange(ts, opts.dateRange)) continue
        const gitBranch = entry.gitBranch
        const project = source.project

        if (entry.type === 'assistant') {
          const msg = entry.message as AssistantMessageContent | undefined
          if (!msg) continue
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
            await writeRecord({
              session_id: sessionId,
              timestamp: ts,
              project,
              git_branch: gitBranch,
              model: msg.model,
              event_type: 'tool_call',
              tool_use_id: tu.id,
              tool_name: tu.name,
              tool_input: tu.input ?? {},
              retry_index: sameToolStreak.index,
            })
          }
          continue
        }

        if (entry.type !== 'user' || !entry.message) continue
        const content = (entry.message as { content?: unknown }).content
        if (Array.isArray(content)) {
          for (const b of content) {
            if (!isToolResultBlock(b)) continue
            const text = toolResultText(b.content)
            const toolName = b.tool_use_id ? toolNameById.get(b.tool_use_id) : undefined
            if (DENIAL_RE.test(text)) {
              await writeRecord({
                session_id: sessionId,
                timestamp: ts,
                project,
                git_branch: gitBranch,
                event_type: 'denial',
                tool_use_id: b.tool_use_id,
                tool_name: toolName,
                denial_reason: text,
              })
              pendingDenial = { sessionId, project, gitBranch, timestamp: ts, tool: toolName, reason: text }
              continue
            }
            const isError = !!b.is_error
            const category: 'error' | 'sibling-cascade' | undefined = isError
              ? (SIBLING_CASCADE_RE.test(text) ? 'sibling-cascade' : 'error')
              : undefined
            await writeRecord({
              session_id: sessionId,
              timestamp: ts,
              project,
              git_branch: gitBranch,
              event_type: 'tool_result',
              tool_use_id: b.tool_use_id,
              tool_name: toolName,
              is_error: isError,
              error_category: category,
              error_message: isError ? text : undefined,
            })
          }
          // Pair the denial with the next free-text user message in the same session.
          // Tool-result-only user entries don't constitute a correction.
          continue
        }

        const text = userMessageText(entry)
        if (text.trim() && pendingDenial && pendingDenial.sessionId === sessionId) {
          await writeRecord({
            session_id: sessionId,
            timestamp: ts,
            project,
            git_branch: gitBranch,
            event_type: 'correction',
            tool_name: pendingDenial.tool,
            denial_reason: pendingDenial.reason,
            correction_text: text.length > 4000 ? text.slice(0, 4000) + '…' : text,
          })
          pendingDenial = null
        }
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
