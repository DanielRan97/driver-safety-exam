// Admin authentication: PBKDF2-SHA256 password hashing (Web Crypto — no
// native bcrypt/argon2 is available in the Workers runtime, but PBKDF2 via
// crypto.subtle is a NIST-approved, standard choice), HttpOnly session
// cookies backed by D1, a double-submit CSRF token, and simple D1-based
// login-attempt throttling.

import { PBKDF2_ITERATIONS } from './constants.mjs';

const SESSION_COOKIE = 'admin_session';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 min
const LOGIN_MAX_ATTEMPTS = 5;

function bytesToHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}
function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}
function timingSafeEqualHex(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function randomToken(bytes = 32) {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function deriveHash(password, saltHex) {
  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: hexToBytes(saltHex), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    256,
  );
  return bytesToHex(new Uint8Array(bits));
}

export async function hashPassword(password) {
  const saltHex = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
  const hash = await deriveHash(password, saltHex);
  return { hash, salt: saltHex, iterations: PBKDF2_ITERATIONS };
}

export async function verifyPassword(password, hashHex, saltHex) {
  const computed = await deriveHash(password, saltHex);
  return timingSafeEqualHex(computed, hashHex);
}

// ---------------------------------------------------------------------
// Login throttling
// ---------------------------------------------------------------------
export async function isLoginThrottled(env, username) {
  // attempted_at is stored via SQLite's CURRENT_TIMESTAMP ("YYYY-MM-DD
  // HH:MM:SS", space-separated) — the cutoff must be computed the same
  // way (not a JS toISOString() "T"-separated string), otherwise the
  // string comparison never matches and throttling silently never fires.
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM admin_login_attempts WHERE username = ? AND succeeded = 0 AND attempted_at > datetime('now', ?)",
  )
    .bind(username, `-${LOGIN_WINDOW_MS / 1000} seconds`)
    .first();
  return (row?.n || 0) >= LOGIN_MAX_ATTEMPTS;
}

export async function recordLoginAttempt(env, username, succeeded) {
  await env.DB.prepare('INSERT INTO admin_login_attempts (username, succeeded, attempted_at) VALUES (?, ?, CURRENT_TIMESTAMP)')
    .bind(username, succeeded ? 1 : 0)
    .run();
}

// ---------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------
export async function createSession(env, adminUserId) {
  const token = randomToken();
  const csrfToken = randomToken(16);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await env.DB.prepare(
    'INSERT INTO admin_sessions (token, admin_user_id, csrf_token, created_at, expires_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?)',
  )
    .bind(token, adminUserId, csrfToken, expiresAt)
    .run();
  return { token, csrfToken, expiresAt };
}

export async function destroySession(env, token) {
  if (!token) return;
  await env.DB.prepare('DELETE FROM admin_sessions WHERE token = ?').bind(token).run();
}

function parseCookies(request) {
  const header = request.headers.get('Cookie') || '';
  const out = {};
  header.split(';').forEach((part) => {
    const eq = part.indexOf('=');
    if (eq === -1) return;
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  });
  return out;
}

// Returns { admin, csrfToken } if the request carries a valid, unexpired
// session; otherwise null. Every /admin and /api/admin/* handler must call
// this and enforce the result itself — nothing here trusts the client.
export async function getAdminFromRequest(request, env) {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (!token) return null;

  const row = await env.DB.prepare(
    `SELECT s.admin_user_id, s.csrf_token, s.expires_at, u.username, u.display_name, u.is_active
     FROM admin_sessions s JOIN admin_users u ON u.id = s.admin_user_id
     WHERE s.token = ?`,
  )
    .bind(token)
    .first();

  if (!row) return null;
  if (!row.is_active) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await destroySession(env, token);
    return null;
  }
  return {
    id: row.admin_user_id,
    username: row.username,
    displayName: row.display_name,
    csrfToken: row.csrf_token,
    sessionToken: token,
  };
}

export function sessionCookieHeader(token, { clear = false } = {}) {
  const maxAge = clear ? 0 : Math.floor(SESSION_TTL_MS / 1000);
  const value = clear ? '' : token;
  return `${SESSION_COOKIE}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

// Double-submit CSRF check for state-changing admin API calls: the token
// handed back at login must be echoed in this header. A cookie alone
// can't prove the request came from our own page's JS.
export function checkCsrf(request, admin) {
  const header = request.headers.get('X-CSRF-Token');
  return !!header && !!admin?.csrfToken && timingSafeEqualHex(header, admin.csrfToken);
}
