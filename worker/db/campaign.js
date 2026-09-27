// Gates the automatic final report so it can only ever be sent once, even
// if two requests both notice "everyone finished" at nearly the same time.
// The UPDATE is the atomic part: only the request whose UPDATE actually
// changes a row (rows-affected > 0) is the "winner" that sends the report.

export async function tryClaimFinalReport(env) {
  const result = await env.DB.prepare(
    "UPDATE campaign_state SET report_sent_at = CURRENT_TIMESTAMP WHERE id = 1 AND report_sent_at IS NULL",
  ).run();
  return result.meta.changes > 0;
}

export async function getCampaignState(env) {
  const row = await env.DB.prepare('SELECT report_sent_at FROM campaign_state WHERE id = 1').first();
  return row || { report_sent_at: null };
}

// Escape hatch if the report ever needs to be regenerated/resent manually
// (see CLOUDFLARE.md) — clears the gate so the next completion (or a
// manual trigger) can send it again.
export async function resetFinalReportGate(env) {
  await env.DB.prepare('UPDATE campaign_state SET report_sent_at = NULL WHERE id = 1').run();
}
