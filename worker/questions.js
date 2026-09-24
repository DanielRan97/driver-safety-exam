// Question bank for the Cloudflare Worker — bundled at build time by
// scripts/build-worker-data.js (Workers have no runtime filesystem access,
// so this can't be read from public/index.html on each request the way
// server/questions.js does on Render).
import questions from './generated/questions.json';

export const PASS_SCORE = 100;

export function getQuestions() {
  return questions;
}
