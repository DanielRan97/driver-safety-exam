-- Marks temporary demo/preview data (see scripts/seed-demo-completed-exams.js)
-- so it can be positively identified and safely removed later without
-- relying on timestamps, names, or any other heuristic. Purely additive;
-- every existing row defaults to 0 (real data), untouched.

ALTER TABLE exam_attempts ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_attempts_is_demo ON exam_attempts(is_demo);
