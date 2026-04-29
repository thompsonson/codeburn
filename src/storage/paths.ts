import { homedir } from 'os'
import { join } from 'path'

export const DEFAULT_DB_DIR = '.codeburn'
export const DEFAULT_DB_FILE = 'usage.db'

export function getDefaultDbPath(): string {
  return join(homedir(), DEFAULT_DB_DIR, DEFAULT_DB_FILE)
}
