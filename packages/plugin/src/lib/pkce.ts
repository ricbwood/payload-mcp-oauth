import crypto from 'crypto'

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
