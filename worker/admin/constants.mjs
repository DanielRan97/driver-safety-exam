// Single source of truth for the PBKDF2 iteration count, shared by the
// Worker's own password verification (worker/admin/auth.js) and the
// offline account-creation script (scripts/create-admin.js) — they must
// never drift, or hashes created by one won't verify against the other.
//
// The Workers runtime's Web Crypto PBKDF2 implementation rejects any
// iteration count above 100000 (NotSupportedError), so this is the hard
// ceiling, not just a tuning choice.
export const PBKDF2_ITERATIONS = 100000;
