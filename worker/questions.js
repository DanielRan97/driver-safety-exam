// Question bank for the Cloudflare Worker — bundled at build time by
// scripts/build-worker-data.js (Workers have no runtime filesystem access,
// so this can't be read from public/index.html on each request the way
// server/questions.js does on Render).
import questions from './generated/questions.json';

// The passing score is no longer hardcoded here — it's a configurable
// D1 setting (system_settings, migrations/0006), read via
// worker/db/settings.js's getPassingScore(). Every new attempt stores
// the threshold actually used at submission time.

export function getQuestions() {
  return questions;
}
