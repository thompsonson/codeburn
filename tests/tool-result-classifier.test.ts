import { describe, it, expect } from 'vitest'

import {
  DENIAL_RE,
  MAX_CORRECTION_TEXT_LEN,
  SIBLING_CASCADE_RE,
  classifyToolResult,
  errorSignature,
  truncateCorrectionText,
} from '../src/tool-result-classifier.js'

describe('errorSignature', () => {
  it('collapses absolute paths to <path>', () => {
    const a = errorSignature('Read', "ENOENT: no such file or directory, open '/Users/alice/proj/src/foo.ts'")
    const b = errorSignature('Read', "ENOENT: no such file or directory, open '/Users/bob/repo/lib/bar.ts'")
    expect(a).toBe(b)
    expect(a).toContain('<path>')
  })

  it('collapses digits to N so error codes group together', () => {
    const a = errorSignature('Bash', 'Process exited with code 1')
    const b = errorSignature('Bash', 'Process exited with code 137')
    expect(a).toBe(b)
    expect(a).toContain('N')
  })

  it('keeps tool name in the signature', () => {
    expect(errorSignature('Edit', 'String to replace not found')).toMatch(/^Edit \| /)
  })

  it('truncates long lines to 120 chars after normalization', () => {
    const long = 'x'.repeat(500)
    const sig = errorSignature('Bash', long)
    // signature = "Bash | " + up to 120 chars
    expect(sig.length).toBeLessThanOrEqual('Bash | '.length + 120)
  })
})

describe('SIBLING_CASCADE_RE', () => {
  it('matches the canonical cascade phrasing case-insensitively', () => {
    expect(SIBLING_CASCADE_RE.test('Sibling tool call errored. Aborting batch.')).toBe(true)
    expect(SIBLING_CASCADE_RE.test('sibling tool call errored')).toBe(true)
  })

  it('does not match unrelated errors', () => {
    expect(SIBLING_CASCADE_RE.test('ENOENT: no such file')).toBe(false)
    expect(SIBLING_CASCADE_RE.test('find: -printf: unknown primary')).toBe(false)
  })
})

describe('DENIAL_RE', () => {
  it('matches the denial phrasings observed in real sessions', () => {
    expect(DENIAL_RE.test('Permission denied')).toBe(true)
    expect(DENIAL_RE.test("user doesn't want to proceed")).toBe(true)
    expect(DENIAL_RE.test('user rejected the tool call')).toBe(true)
    expect(DENIAL_RE.test('Tool use was rejected by the user')).toBe(true)
  })

  it('does not match generic execution errors', () => {
    expect(DENIAL_RE.test('command not found')).toBe(false)
    expect(DENIAL_RE.test('Sibling tool call errored')).toBe(false)
  })
})

describe('classifyToolResult', () => {
  it('returns null when not an error and not a denial', () => {
    expect(classifyToolResult({ type: 'tool_result', is_error: false, content: 'ok' })).toBeNull()
  })

  it('classifies denial regardless of is_error flag', () => {
    expect(classifyToolResult({ type: 'tool_result', is_error: false, content: 'Permission denied' }))
      .toEqual({ category: 'denial', text: 'Permission denied' })
  })

  it('prefers sibling-cascade over generic error', () => {
    expect(classifyToolResult({ type: 'tool_result', is_error: true, content: 'Sibling tool call errored' }))
      .toEqual({ category: 'sibling-cascade', text: 'Sibling tool call errored' })
  })

  it('reads tool_result content from text-block arrays', () => {
    const result = classifyToolResult({
      type: 'tool_result',
      is_error: true,
      content: [{ type: 'text', text: 'ENOENT: no such file' }],
    })
    expect(result?.category).toBe('error')
    expect(result?.text).toBe('ENOENT: no such file')
  })
})

describe('truncateCorrectionText', () => {
  it('passes short text through unchanged', () => {
    expect(truncateCorrectionText('short message')).toBe('short message')
  })

  it('truncates at MAX_CORRECTION_TEXT_LEN with ellipsis marker', () => {
    const text = 'a'.repeat(MAX_CORRECTION_TEXT_LEN + 100)
    const result = truncateCorrectionText(text)
    expect(result.length).toBe(MAX_CORRECTION_TEXT_LEN + 1) // + ellipsis char
    expect(result.endsWith('…')).toBe(true)
  })

  it('does not truncate at exactly the limit (boundary)', () => {
    const text = 'a'.repeat(MAX_CORRECTION_TEXT_LEN)
    const result = truncateCorrectionText(text)
    expect(result).toBe(text)
    expect(result.endsWith('…')).toBe(false)
  })

  it('truncates one char over the limit', () => {
    const text = 'a'.repeat(MAX_CORRECTION_TEXT_LEN + 1)
    const result = truncateCorrectionText(text)
    expect(result.endsWith('…')).toBe(true)
  })
})
