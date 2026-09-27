-- Two changes, both additive/non-destructive:
--
-- 1) Configurable passing score. Was hardcoded as PASS_SCORE=100 in
--    worker/questions.js — now a persistent D1 setting the Worker reads
--    on every submission, editable from the Admin Dashboard. Seeded with
--    exactly the value that was hardcoded before this migration, so
--    behavior is unchanged until an admin explicitly changes it.
--    exam_attempts gets a snapshot column so a later change to
--    system_settings never retroactively changes what counted as
--    "passed" for an attempt already on record.
--
-- 2) Removes 'tester' as a recognized business role. Production already
--    has zero role='tester' rows as of migration 0005 (Daniel Ran and
--    Efi Caro were converted to 'driver' there) — this UPDATE is a
--    defensive, idempotent no-op that only matters if a tester row was
--    ever reintroduced. The `role` column itself is kept (still used to
--    distinguish 'driver'), just 'tester' is no longer a value any
--    application code checks for or produces.

CREATE TABLE system_settings (
  key                   TEXT PRIMARY KEY,
  value                 TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  updated_by_admin_id   INTEGER NULL REFERENCES admin_users(id)
);

INSERT INTO system_settings (key, value, updated_at) VALUES ('passing_score', '100', CURRENT_TIMESTAMP);

ALTER TABLE exam_attempts ADD COLUMN passing_score_at_submission INTEGER;

CREATE TABLE admin_audit_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_user_id   INTEGER NOT NULL REFERENCES admin_users(id),
  action          TEXT NOT NULL,
  details_json    TEXT,
  created_at      TEXT NOT NULL
);

UPDATE employees SET role = 'driver' WHERE role = 'tester';
