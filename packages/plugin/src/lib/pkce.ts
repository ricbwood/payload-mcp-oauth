import crypto from 'crypto'

// RFC 7636 §4.1: code_verifier is 43-128 chars of the unreserved set [A-Za-z0-9-._~]
const CODE_VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/
// RFC 7636 §4.2: code_challenge is base64url(SHA-256(verifier)) — always 43 unpadded chars
const CODE_CHALLENGE_RE = /^[A-Za-z0-9\-_]{43}$/

export function validateCodeVerifier(verifier: string): boolean {
  return typeof verifier === 'string' && CODE_VERIFIER_RE.test(verifier)
}

export function validateCodeChallenge(challenge: string): boolean {
  return typeof challenge === 'string' && CODE_CHALLENGE_RE.test(challenge)
}

export class PkceError extends Error {
  readonly code = 'PKCE_METHOD_NOT_SUPPORTED' as const

  constructor(method: string) {
    super(
      `Unsupported code_challenge_method: "${method}". ` +
        'Only S256 is accepted. plain is permanently disabled.',
    )
    this.name = 'PkceError'
  }
}

export function verifyPkce(verifier: string, challenge: string, method: string): boolean {
  if (method !== 'S256') {
    throw new PkceError(method)
  }

  const computed = crypto.createHash('sha256').update(verifier).digest('base64url')

  const computedBuf = Buffer.from(computed, 'base64url')
  const challengeBuf = Buffer.from(challenge, 'base64url')

  if (computedBuf.length !== challengeBuf.length) {
    crypto.timingSafeEqual(computedBuf, computedBuf)
    return false
  }

  return crypto.timingSafeEqual(computedBuf, challengeBuf)
}
