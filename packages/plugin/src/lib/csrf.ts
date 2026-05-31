import crypto from 'crypto'
import { hashToken } from './token-storage.js'

export function makeCsrfToken(
  userId: string,
  clientId: string,
  redirectUri: string,
  codeChallenge: string,
): string {
  return hashToken(`csrf|${userId}|${clientId}|${redirectUri}|${codeChallenge}`)
}

export function verifyCsrfToken(
  token: string | undefined,
  userId: string,
  clientId: string,
  redirectUri: string,
  codeChallenge: string,
): boolean {
  if (!token) return false
  const expected = makeCsrfToken(userId, clientId, redirectUri, codeChallenge)
  try {
    const tokenBuf = Buffer.from(token, 'hex')
    const expectedBuf = Buffer.from(expected, 'hex')
    if (tokenBuf.length !== expectedBuf.length) return false
    return crypto.timingSafeEqual(tokenBuf, expectedBuf)
  } catch {
    return false
  }
}
