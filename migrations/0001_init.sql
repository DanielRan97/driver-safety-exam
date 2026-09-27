-- Core schema for the driver database + exam attempt tracking.
--
-- national_id is TEXT everywhere, on purpose: Israeli IDs can start with a
-- leading zero ("052562568"), which a numeric column would silently strip.
-- Never cast it to an integer.

CREATE TABLE employees (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name    TEXT NOT NULL,
  last_name     TEXT NOT NULL,
  employee_no   TEXT,
  national_id   TEXT NOT NULL UNIQUE,
  role          TEXT NOT NULL DEFAULT 'driver',   -- 'driver' | 'tester'
  is_required   INTEGER NOT NULL DEFAULT 1,        -- 1 = counts toward completion stats
  can_do_again  INTEGER NOT NULL DEFAULT 0,        -- one-time override, auto-resets after use
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL
);

CREATE INDEX idx_employees_national_id ON employees(national_id);
CREATE INDEX idx_employees_required ON employees(role, is_required, is_active);

CREATE TABLE exam_attempts (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id         INTEGER NULL REFERENCES employees(id),
  is_guest            INTEGER NOT NULL DEFAULT 0,

  -- Snapshot of whoever took the exam (resolved server-side at submit
  -- time) — always populated, guest or not. Kept denormalized so a retry
  -- (found by submission_token) never needs to join back to employees,
  -- and so the record stays meaningful even if an employee row later
  -- changes.
  first_name          TEXT NOT NULL,
  last_name           TEXT NOT NULL,
  employee_no         TEXT,
  national_id         TEXT NOT NULL,

  submission_token    TEXT NOT NULL UNIQUE, -- idempotency key from the client

  email               TEXT,
  date_field          TEXT,   -- the "date" the driver entered on the form
  lang                TEXT,

  score               INTEGER,
  correct_count       INTEGER,
  passed              INTEGER,

  started_at          TEXT,
  submitted_at        TEXT,
  completed_at        TEXT NULL,

  email_status        TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'sent' | 'failed'
  email_sent_at       TEXT NULL,
  email_error         TEXT NULL,

  questions_snapshot  TEXT, -- JSON: [{index, q, opts, correct}, ...] as of this attempt
  answers_json        TEXT, -- JSON: [{questionIndex, chosen, correct, isCorrect}, ...]
  statistics_json      TEXT, -- JSON: small derived summary for this attempt

  created_at          TEXT NOT NULL
);

CREATE INDEX idx_attempts_employee ON exam_attempts(employee_id);
CREATE INDEX idx_attempts_email_status ON exam_attempts(email_status);
CREATE INDEX idx_attempts_token ON exam_attempts(submission_token);

-- Single-row table gating the automatic final report so it can only ever
-- be sent once, even under concurrent/duplicate requests (guarded with an
-- atomic "UPDATE ... WHERE report_sent_at IS NULL" — see worker/db/campaign.js).
CREATE TABLE campaign_state (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  report_sent_at  TEXT NULL
);

INSERT INTO campaign_state (id, report_sent_at) VALUES (1, NULL);
