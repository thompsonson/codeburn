// Tool-result classification shared by the parser (analytics aggregation) and
// the event-export (per-event JSONL stream). Keep regexes and signature
// normalization in one place so the two pipelines can't drift.

export const SIBLING_CASCADE_RE = /sibling tool call errored/i
// Denial signatures observed in real Claude session JSONLs across permission flows.
export const DENIAL_RE = /(permission denied|doesn['’]t want to proceed|is not allowed by user|tool use was rejected|user rejected the tool call|user (?:has )?denied|tool denied)/i

export type ToolResultBlock = {
  type: 'tool_result'
  tool_use_id?: string
  is_error?: boolean
  content?: unknown
}

export function isToolResultBlock(b: unknown): b is ToolResultBlock {
  return !!b && typeof b === 'object' && (b as { type?: unknown }).type === 'tool_result'
}

export function toolResultText(content: unknown): string {
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

export type ToolEventCategory = 'error' | 'denial' | 'sibling-cascade'

export type ClassifiedToolEvent = {
  category: ToolEventCategory
  text: string
}

export function classifyToolResult(block: ToolResultBlock): ClassifiedToolEvent | null {
  const text = toolResultText(block.content)
  if (DENIAL_RE.test(text)) return { category: 'denial', text }
  if (!block.is_error) return null
  if (SIBLING_CASCADE_RE.test(text)) return { category: 'sibling-cascade', text }
  return { category: 'error', text }
}

export function firstNonEmptyLine(s: string, maxLen = 200): string {
  for (const raw of s.split('\n')) {
    const t = raw.trim()
    if (t) return t.length > maxLen ? t.slice(0, maxLen) + '…' : t
  }
  return ''
}

// Normalize file paths and numbers so unrelated argument values collapse onto
// one pattern (e.g. ENOENT on different files becomes a single bucket). Keeps
// cardinality low for the top-error-patterns view.
export function errorSignature(tool: string, firstLine: string): string {
  const norm = firstLine
    .replace(/(?:[\w.@~-]+)?\/(?:[^\s/'":]+\/)*[^\s/'":]+/g, '<path>')
    .replace(/\b\d+\b/g, 'N')
    .slice(0, 120)
  return `${tool} | ${norm}`
}

export const MAX_CORRECTION_TEXT_LEN = 4000

// Used by the JSONL event export to bound user-message size in correction
// records. The ellipsis marker preserves the "this was truncated" signal for
// downstream consumers.
export function truncateCorrectionText(text: string, max = MAX_CORRECTION_TEXT_LEN): string {
  return text.length > max ? text.slice(0, max) + '…' : text
}

// Some denial tool_result payloads inline the user's correction after a
// "the user said:" marker (curly or straight quote). Extract that text so
// downstream consumers see the correction without needing the next user turn.
const INLINE_CORRECTION_RE = /the user said:\s*\n?([\s\S]+)$/i

export function extractInlineCorrection(denialText: string): string | undefined {
  const m = denialText.match(INLINE_CORRECTION_RE)
  if (!m) return undefined
  const t = m[1].trim()
  return t ? t : undefined
}
