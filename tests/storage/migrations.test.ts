import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import { openDatabaseWrite } from '../../src/sqlite.js'
import { MIGRATIONS, getCurrentVersion, runMigrations, targetVersion } from '../../src/storage/migrations.js'

describe('migrations', () => {
  let base: string

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'codeburn-mig-'))
  })

  afterEach(async () => {
    await rm(base, { recursive: true, force: true })
  })

  it('initializes schema from version 0', () => {
    const db = openDatabaseWrite(join(base, 'usage.db'))
    expect(getCurrentVersion(db)).toBe(0)
    runMigrations(db)
    expect(getCurrentVersion(db)).toBe(targetVersion())

    const tables = db.query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).map(r => r.name)
    expect(tables).toEqual(
      expect.arrayContaining(['sessions', 'tool_breakdown', 'error_patterns', 'tool_events', 'ingest_state'])
    )
    db.close()
  })

  it('is idempotent on re-run', () => {
    const path = join(base, 'usage.db')
    const a = openDatabaseWrite(path)
    runMigrations(a)
    a.close()

    const b = openDatabaseWrite(path)
    expect(getCurrentVersion(b)).toBe(targetVersion())
    runMigrations(b)
    expect(getCurrentVersion(b)).toBe(targetVersion())
    b.close()
  })

  it('exposes target version matching highest migration', () => {
    const max = MIGRATIONS.reduce((m, x) => Math.max(m, x.version), 0)
    expect(targetVersion()).toBe(max)
  })
})
