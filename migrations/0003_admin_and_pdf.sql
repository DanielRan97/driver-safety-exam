-- Admin dashboard: authentication, sessions, PDF storage tracking.
-- Purely additive — no existing columns/rows are touched or dropped, so
-- historical attempts (including Daniel's test runs) are unaffected.

CREATE TABLE admin_users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  username       TEXT NOT NULL UNIQUE, -- e.g. 'daniel', 'efi' — not an email, not a national ID
  display_name   TEXT NOT NULL,
  password_hash  TEXT NOT NULL, -- PBKDF2-SHA256 hex digest
  password_salt  TEXT NOT NULL, -- hex, unique per user
  role           TEXT NOT NULL DEFAULT 'admin',
  is_active      INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL
);

CREATE TABLE admin_sessions (
  token           TEXT PRIMARY KEY, -- random session token (the cookie value)
  admin_user_id   INTEGER NOT NULL REFERENCES admin_users(id),
  csrf_token      TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  expires_at      TEXT NOT NULL
);

CREATE INDEX idx_admin_sessions_expires ON admin_sessions(expires_at);

-- Simple login-attempt throttling (no Durable Objects needed for this scale).
CREATE TABLE admin_login_attempts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL,
  succeeded     INTEGER NOT NULL,
  attempted_at  TEXT NOT NULL
);

CREATE INDEX idx_login_attempts_username_time ON admin_login_attempts(username, attempted_at);

-- PDF now lives in R2, generated in the background after the attempt is
-- already safely stored — these track that side process independently of
-- exam completion itself.
ALTER TABLE exam_attempts ADD COLUMN pdf_r2_key TEXT;
ALTER TABLE exam_attempts ADD COLUMN pdf_status TEXT NOT NULL DEFAULT 'pending'; -- 'pending' | 'stored' | 'failed'
ALTER TABLE exam_attempts ADD COLUMN pdf_error TEXT;
ALTER TABLE exam_attempts ADD COLUMN pdf_created_at TEXT;
