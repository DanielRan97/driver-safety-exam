// Backup of every submission, in case the email never arrives — replaces
// server/storage.js's append-only CSV file, which needs a real disk that
// Workers don't have. Cloudflare KV is the equivalent lightweight,
// genuinely-needed piece of infrastructure here (not an "extra service" —
// it's a direct substitute for the local file the Render version wrote).
//
// List/export entries with:
//   wrangler kv key list --binding=SUBMISSIONS_KV
//   wrangler kv key get --binding=SUBMISSIONS_KV "<key>"
export async function logSubmission(env, submission) {
  if (!env.SUBMISSIONS_KV) return; // binding optional locally if not configured yet
  const key = `${submission.submittedAt}_${submission.empnum || submission.id}`;
  await env.SUBMISSIONS_KV.put(key, JSON.stringify(submission));
}
