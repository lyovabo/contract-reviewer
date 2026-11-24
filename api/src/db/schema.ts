import type Database from 'better-sqlite3';

/**
 * All timestamps the rules depend on are integer epoch milliseconds, so the review deadline and
 * the monthly window are plain integer comparisons against a clock value bound as a parameter.
 * SQLite's own `now` is never used.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS lawyers (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL,
  title TEXT NOT NULL
);

-- Documents (and so the monthly plan) belong to a workspace. A lawyer can be a member of several
-- workspaces; the sample data has one, shared by all its lawyers.
CREATE TABLE IF NOT EXISTS workspaces (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  lawyer_id    TEXT NOT NULL REFERENCES lawyers(id),
  PRIMARY KEY (workspace_id, lawyer_id)
);

CREATE TABLE IF NOT EXISTS documents (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  title        TEXT NOT NULL,
  type         TEXT NOT NULL,
  pages        INTEGER NOT NULL,
  uploaded_at  TEXT NOT NULL,
  uploaded_by  TEXT NOT NULL REFERENCES lawyers(id),
  supersedes   TEXT REFERENCES documents(id)
);

-- The fake AI's script: what a review of each document returns, in order.
CREATE TABLE IF NOT EXISTS document_findings (
  document_id TEXT NOT NULL REFERENCES documents(id),
  position    INTEGER NOT NULL,
  clause      TEXT,
  title       TEXT NOT NULL,
  severity    TEXT NOT NULL CHECK (severity IN ('high', 'medium', 'low')),
  excerpt     TEXT,
  explanation TEXT NOT NULL,
  PRIMARY KEY (document_id, position)
);

-- The contract itself and the party the firm acts for, for the real AI reviewer (the fake one
-- only needs the script above).
CREATE TABLE IF NOT EXISTS document_contracts (
  document_id TEXT PRIMARY KEY REFERENCES documents(id),
  client      TEXT,
  body        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reviews (
  id              TEXT PRIMARY KEY,
  document_id     TEXT NOT NULL REFERENCES documents(id),
  requested_by    TEXT NOT NULL REFERENCES lawyers(id),
  requested_at_ms INTEGER NOT NULL,
  -- Fixed when the review is requested (reviewDeadlineMs in config.json), so a later change of
  -- the setting never changes an existing review.
  deadline_at_ms  INTEGER NOT NULL CHECK (deadline_at_ms > requested_at_ms),
  status          TEXT NOT NULL CHECK (status IN ('in_progress', 'completed', 'failed')),
  -- Which AI ran it: the simulated one or Claude, chosen by the lawyer for this review.
  reviewer        TEXT NOT NULL DEFAULT 'fake' CHECK (reviewer IN ('fake', 'claude')),
  finished_at_ms  INTEGER,
  failure_reason  TEXT CHECK (failure_reason IN ('engine_error', 'timeout', 'interrupted', 'launch_error')),
  CHECK ((status = 'in_progress') = (finished_at_ms IS NULL)),
  CHECK ((status = 'failed') = (failure_reason IS NOT NULL))
);

-- Backstop for "at most one review in progress per document", whoever requested it.
CREATE UNIQUE INDEX IF NOT EXISTS reviews_one_in_progress_per_document
  ON reviews(document_id) WHERE status = 'in_progress';
CREATE INDEX IF NOT EXISTS reviews_by_document ON reviews(document_id, requested_at_ms);
CREATE INDEX IF NOT EXISTS reviews_by_requested_at ON reviews(requested_at_ms);

-- At most one live session per lawyer (the primary key): while one browser is using a lawyer,
-- nobody else can act as that lawyer. A session is live while last_seen_ms is recent.
CREATE TABLE IF NOT EXISTS lawyer_sessions (
  lawyer_id    TEXT PRIMARY KEY REFERENCES lawyers(id),
  token        TEXT NOT NULL UNIQUE,
  last_seen_ms INTEGER NOT NULL
);

-- What a review actually returned before it finished (or failed).
CREATE TABLE IF NOT EXISTS review_findings (
  review_id      TEXT NOT NULL REFERENCES reviews(id),
  position       INTEGER NOT NULL,
  clause         TEXT,
  title          TEXT NOT NULL,
  severity       TEXT NOT NULL CHECK (severity IN ('high', 'medium', 'low')),
  excerpt        TEXT,
  explanation    TEXT NOT NULL,
  received_at_ms INTEGER NOT NULL,
  PRIMARY KEY (review_id, position)
);
`;

/**
 * Creates the tables, and brings a database made by an older version up to date.
 * `reviewDeadlineMs` is only used to fill in the deadline of reviews made before it was stored.
 */
export function migrate(db: Database.Database, reviewDeadlineMs: number): void {
  db.exec(SCHEMA);
  // Databases created before workspaces existed: add the ownership column. The seed then fills
  // it. (SQLite cannot add a NOT NULL column without a default, so it stays nullable there.)
  const columns = db.prepare(`PRAGMA table_info(documents)`).all() as { name: string }[];
  if (!columns.some((c) => c.name === 'workspace_id')) {
    db.exec(`ALTER TABLE documents ADD COLUMN workspace_id TEXT REFERENCES workspaces(id)`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS documents_by_workspace ON documents(workspace_id)`);

  // Databases created before each review stored its deadline: add the column, and give the
  // existing reviews the deadline in force now, which is what they were measured against until
  // then. (Nullable here too, for the same reason as above.)
  const reviewColumns = db.prepare(`PRAGMA table_info(reviews)`).all() as { name: string }[];
  // Databases created before the AI was chosen per review: their reviews count as simulated.
  if (!reviewColumns.some((c) => c.name === 'reviewer')) {
    db.exec(`ALTER TABLE reviews ADD COLUMN reviewer TEXT NOT NULL DEFAULT 'fake' CHECK (reviewer IN ('fake', 'claude'))`);
  }
  if (!reviewColumns.some((c) => c.name === 'deadline_at_ms')) {
    db.transaction(() => {
      db.exec(`ALTER TABLE reviews ADD COLUMN deadline_at_ms INTEGER`);
      db.prepare(`UPDATE reviews SET deadline_at_ms = requested_at_ms + ?`).run(reviewDeadlineMs);
    })();
  }
}
