import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, cp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import { parseAllSessions } from '../src/parser.js'
import type { DateRange } from '../src/types.js'

const FIXTURE_DAY = Date.UTC(2026, 3, 16)
const PROJECT_NAME = 'codeburn-tool-errors'

function makeRange(): DateRange {
  return {
    start: new Date(FIXTURE_DAY - 24 * 60 * 60 * 1000),
    end: new Date(FIXTURE_DAY + 24 * 60 * 60 * 1000),
  }
}

describe('tool error analytics', () => {
  let originalConfigDir: string | undefined
  let base: string

  beforeEach(async () => {
    originalConfigDir = process.env['CLAUDE_CONFIG_DIR']
    base = await mkdtemp(join(tmpdir(), 'codeburn-errs-'))
    const projectDir = join(base, 'projects', PROJECT_NAME)
    await mkdir(projectDir, { recursive: true })
    await cp(
      join(__dirname, 'fixtures', 'parser', 'tool-errors.jsonl'),
      join(projectDir, 'sess.jsonl'),
    )
    process.env['CLAUDE_CONFIG_DIR'] = base
  })

  afterEach(async () => {
    if (originalConfigDir === undefined) delete process.env['CLAUDE_CONFIG_DIR']
    else process.env['CLAUDE_CONFIG_DIR'] = originalConfigDir
    await rm(base, { recursive: true, force: true })
  })

  it('counts errors, denials, and sibling-cascade per tool', async () => {
    const projects = await parseAllSessions(makeRange(), 'claude')
    const project = projects.find(p => p.project === PROJECT_NAME)
    expect(project).toBeDefined()
    const session = project!.sessions[0]!
    expect(session.toolBreakdown.Bash).toMatchObject({ calls: 2, errors: 1, siblingCascadeErrors: 1 })
    expect(session.toolBreakdown.Read).toMatchObject({ calls: 1, errors: 1 })
    expect(session.toolBreakdown.Edit).toMatchObject({ calls: 1, denials: 1 })
    expect(session.toolBreakdown.Edit.errors ?? 0).toBe(0)
  })

  it('produces error patterns sorted by count, excluding denials', async () => {
    const projects = await parseAllSessions(makeRange(), 'claude')
    const session = projects.find(p => p.project === PROJECT_NAME)!.sessions[0]!
    const patterns = session.errorPatterns ?? []
    expect(patterns.length).toBeGreaterThan(0)
    expect(patterns.find(p => /Permission denied/i.test(p.example))).toBeUndefined()
    const findPattern = patterns.find(p => p.tool === 'Bash' && /-printf/.test(p.example))
    expect(findPattern).toBeDefined()
  })

  it('captures gitBranch from session entries', async () => {
    const projects = await parseAllSessions(makeRange(), 'claude')
    const session = projects.find(p => p.project === PROJECT_NAME)!.sessions[0]!
    expect(session.gitBranch).toBe('feat/errors')
  })
})
