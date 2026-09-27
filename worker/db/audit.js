// Small admin action audit log (migrations/0006) — who changed what,
// and when. Currently used for passing-score changes only.

export async function recordAuditLog(env, { adminUserId, action, details }) {
  await env.DB.prepare(
    'INSERT INTO admin_audit_log (admin_user_id, action, details_json, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)',
  )
    .bind(adminUserId, action, JSON.stringify(details || {}))
    .run();
}
