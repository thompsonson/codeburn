import { describe, expect, it } from 'vitest'
import { homedir } from 'os'
import { join } from 'path'

import { DEFAULT_DB_DIR, DEFAULT_DB_FILE, getDefaultDbPath } from '../../src/storage/paths.js'

describe('getDefaultDbPath', () => {
  it('points at ~/.codeburn/usage.db', () => {
    expect(getDefaultDbPath()).toBe(join(homedir(), DEFAULT_DB_DIR, DEFAULT_DB_FILE))
    expect(DEFAULT_DB_DIR).toBe('.codeburn')
    expect(DEFAULT_DB_FILE).toBe('usage.db')
  })
})
