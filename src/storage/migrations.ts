import type { WritableSqliteDatabase } from '../sqlite.js'

export type Migration = {
  version: number
  up: (db: WritableSqliteDatabase) => void
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    up: (db) => {
      db.exec(`
        CREATE TABLE sessions (
          machine_id        TEXT NOT NULL,
          session_id        TEXT NOT NULL,
          provider          TEXT NOT NULL,
          parent_session_id TEXT,
          project           TEXT NOT NULL,
          project_path      TEXT,
          git_branch        TEXT,
          first_ts          TEXT NOT NULL,
          last_ts           TEXT NOT NULL,
          cost_usd          REAL NOT NULL,
          api_calls         INTEGER NOT NULL,
          input_tokens     INTEGER NOT NULL,
          output_tokens    INTEGER NOT NULL,
          cache_read       INTEGER NOT NULL,
          cache_write      INTEGER NOT NULL,
          PRIMARY KEY (machine_id, session_id)
        );

        CREATE TABLE tool_breakdown (
          machine_id      TEXT NOT NULL,
          session_id      TEXT NOT NULL,
          tool            TEXT NOT NULL,
          calls           INTEGER NOT NULL DEFAULT 0,
          errors          INTEGER NOT NULL DEFAULT 0,
          denials         INTEGER NOT NULL DEFAULT 0,
          sibling_cascade INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (machine_id, session_id, tool),
          FOREIGN KEY (machine_id, session_id) REFERENCES sessions(machine_id, session_id) ON DELETE CASCADE
        );

        CREATE TABLE error_patterns (
          machine_id  TEXT NOT NULL,
          session_id  TEXT NOT NULL,
          tool        TEXT NOT NULL,
          signature   TEXT NOT NULL,
          count       INTEGER NOT NULL,
          example     TEXT,
          PRIMARY KEY (machine_id, session_id, tool, signature),
          FOREIGN KEY (machine_id, session_id) REFERENCES sessions(machine_id, session_id) ON DELETE CASCADE
        );

        CREATE TABLE tool_events (
          machine_id      TEXT NOT NULL,
          session_id      TEXT NOT NULL,
          line_no         INTEGER NOT NULL,
          sub_index       INTEGER NOT NULL,
          ts              TEXT NOT NULL,
          event_type      TEXT NOT NULL,
          message_id      TEXT,
          tool_use_id     TEXT,
          tool_name       TEXT,
          tool_input      TEXT,
          is_error        INTEGER,
          error_category  TEXT,
          error_message   TEXT,
          denial_reason   TEXT,
          correction_text TEXT,
          retry_index     INTEGER,
          git_branch      TEXT,
          model           TEXT,
          PRIMARY KEY (machine_id, session_id, line_no, sub_index),
          FOREIGN KEY (machine_id, session_id) REFERENCES sessions(machine_id, session_id) ON DELETE CASCADE
        );

        CREATE TABLE ingest_state (
          machine_id        TEXT NOT NULL,
          file_path         TEXT NOT NULL,
          mtime_ms          INTEGER NOT NULL,
          size_bytes        INTEGER NOT NULL,
          last_line_no      INTEGER NOT NULL,
          last_ingested_at  TEXT NOT NULL,
          PRIMARY KEY (machine_id, file_path)
        );

        CREATE INDEX idx_sessions_provider_ts ON sessions(provider, last_ts);
        CREATE INDEX idx_tool_events_session ON tool_events(machine_id, session_id, ts);
      `)
    },
  },
]

export function getCurrentVersion(db: WritableSqliteDatabase): number {
  const row = db.prepare('PRAGMA user_version').get<{ user_version: number }>()
  return row?.user_version ?? 0
}

export function targetVersion(): number {
  return MIGRATIONS.reduce((max, m) => Math.max(max, m.version), 0)
}

export function runMigrations(db: WritableSqliteDatabase): void {
  const current = getCurrentVersion(db)
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue
    db.transaction(() => {
      m.up(db)
      db.exec(`PRAGMA user_version = ${m.version}`)
    })
  }
}
