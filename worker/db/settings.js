// Configurable system settings persisted in D1 (migrations/0006). The
// passing score used to be a hardcoded PASS_SCORE constant — it now
// lives here so the Admin Dashboard can change it without a deploy.

const PASSING_SCORE_KEY = 'passing_score';
// Only used if the seeded row is ever missing entirely (should not
// happen after migrations/0006) — not a silent substitute for it.
const FALLBACK_PASSING_SCORE = 100;

export async function getPassingScore(env) {
  const row = await env.DB.prepare('SELECT value FROM system_settings WHERE key = ?')
    .bind(PASSING_SCORE_KEY)
    .first();
  const n = row ? Number(row.value) : NaN;
  return Number.isInteger(n) ? n : FALLBACK_PASSING_SCORE;
}

export async function setPassingScore(env, newScore, adminUserId) {
  await env.DB.prepare(
    'UPDATE system_settings SET value = ?, updated_at = CURRENT_TIMESTAMP, updated_by_admin_id = ? WHERE key = ?',
  )
    .bind(String(newScore), adminUserId, PASSING_SCORE_KEY)
    .run();
}
