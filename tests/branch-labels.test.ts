import { describe, it, expect } from 'vitest'
import { getBranchLabel, resolveBranchLabels } from '../src/config.js'

describe('getBranchLabel', () => {
  const labels = resolveBranchLabels()

  it('matches feature branches via prefix', () => {
    expect(getBranchLabel('feat/issue-1', labels)).toBe('Feature')
    expect(getBranchLabel('feature/big-thing', labels)).toBe('Feature')
  })

  it('matches docs/adr ahead of generic docs/ via longest-pattern wins', () => {
    expect(getBranchLabel('docs/adr/001', labels)).toBe('ADR')
    expect(getBranchLabel('docs/readme', labels)).toBe('Docs')
  })

  it('returns undefined for unmatched branches', () => {
    expect(getBranchLabel('main', labels)).toBeUndefined()
    expect(getBranchLabel('random-branch', labels)).toBeUndefined()
    expect(getBranchLabel(undefined, labels)).toBeUndefined()
  })

  it('honors custom config when provided', () => {
    const custom = resolveBranchLabels({ branchLabels: { 'spike/': 'Spike' } })
    expect(getBranchLabel('spike/oauth', custom)).toBe('Spike')
    expect(getBranchLabel('feat/x', custom)).toBeUndefined()
  })
})
