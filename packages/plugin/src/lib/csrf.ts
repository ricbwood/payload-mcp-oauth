import crypto from 'crypto'
import { hashToken } from './token-storage.js'

// CSRF tokens are time-bound. The wire format is "<issuedAtMs>.<hmacHex>" where
// the HMAC covers the issuedAt timestamp alongside the bound parameters, so the
// timestamp cannot be tampered without invalidating the token. A token is
// rejected once it is older than `maxAgeMs` (or issued in the future beyond a
// small clock-skew allowance). Combined with the session-binding check at
// /consent (req.user must match the user the token was minted for) and PKCE,
// this closes the previously replayable/non-expiring CSRF gap.
const DEFAULT_MAX_AGE_MS = 10 * 60 * 1000 // 10 minutes
const CLOCK_SKEW_MS = 60 * 1000 // tolerate 1 minute of clock skew

function sign(
  userId: string,
  clientId: string,
  redirectUri: string,
  codeChallenge: string,
  issuedAt: number,
): string {
  return hashToken(`csrf|${userId}|${clientId}|${redirectUri}|${codeChallenge}|${issuedAt}`)
}

export function makeCsrfToken(
  userId: string,
  clientId: string,
  redirectUri: string,
  codeChallenge: string,
  issuedAt: number = Date.now(),
): string {
  return `${issuedAt}.${sign(userId, clientId, redirectUri, codeChallenge, issuedAt)}`
}

export function verifyCsrfToken(
  token: string | undefined,
  userId: string,
  clientId: string,
  redirectUri: string,
  codeChallenge: string,
  maxAgeMs: number = DEFAULT_MAX_AGE_MS,
): boolean {
  // Guard the wire format before doing any work on it. `token` is typed as
  // string but originates from a parsed request body, so a malicious client can
  // make it a number/object/array at runtime — calling string methods on those
  // would throw. A timestamp is at most 13 digits and the MAC is always 64 hex
  // chars (HMAC-SHA-256), so anything outside those bounds is rejected cheaply
  // before we hex-decode or allocate.
  if (typeof token !== 'string') return false

  const dot = token.indexOf('.')
  if (dot <= 0 || dot > 15) return false

  const mac = token.slice(dot + 1)
  if (mac.length !== 64) return false

  const issuedAt = Number(token.slice(0, dot))
  if (!Number.isInteger(issuedAt) || issuedAt <= 0) return false

  // Reject expired tokens and tokens minted in the future beyond clock skew.
  const age = Date.now() - issuedAt
  if (age > maxAgeMs || age < -CLOCK_SKEW_MS) return false

  const expected = sign(userId, clientId, redirectUri, codeChallenge, issuedAt)
  try {
    const tokenBuf = Buffer.from(mac, 'hex')
    const expectedBuf = Buffer.from(expected, 'hex')
    if (tokenBuf.length !== expectedBuf.length) return false
    return crypto.timingSafeEqual(tokenBuf, expectedBuf)
  } catch {
    return false
  }
}
