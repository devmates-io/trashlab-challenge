import { randomBytes } from "node:crypto";
import bcrypt from "bcrypt";

// Demo-grade defaults: §6.5.1 calls out that this is not production hardened.
// 7-day session TTL is long enough that the reviewer never has to log in mid
// walkthrough but short enough that an abandoned token doesn't live forever.
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const BCRYPT_COST = 10;

// 32 random bytes → 64 hex chars. Uses node:crypto's CSPRNG.
export function generateSessionToken(): string {
  return randomBytes(32).toString("hex");
}

// Returns now + SESSION_TTL_MS. Centralised so tests / future callers can
// swap the clock if needed without grepping for the constant.
export function newSessionExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + SESSION_TTL_MS);
}

// Wraps bcrypt.compare so route handlers don't have to care about the cost
// constant. Returns false on null/undefined hash (e.g., legacy users without
// a password) so the calling endpoint can fall through to the uniform 401.
export async function verifyPassword(
  plaintext: string,
  hash: string | null | undefined,
): Promise<boolean> {
  if (!hash) return false;
  return bcrypt.compare(plaintext, hash);
}

// Wraps bcrypt.hash so callers don't repeat the cost.
export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, BCRYPT_COST);
}

// Reads "Authorization: Bearer <token>" and returns the token, or null when
// the header is absent / malformed. Centralised so middleware and routes
// agree on what counts as "malformed".
export function extractBearerToken(headerValue: string | undefined): string | null {
  if (!headerValue) return null;
  const trimmed = headerValue.trim();
  if (!trimmed.toLowerCase().startsWith("bearer ")) return null;
  const token = trimmed.slice(7).trim();
  return token === "" ? null : token;
}
