export async function findAdminByUsername(env, username) {
  const row = await env.DB.prepare(
    'SELECT id, username, display_name, password_hash, password_salt, is_active FROM admin_users WHERE username = ?',
  )
    .bind(username)
    .first();
  return row || null;
}
