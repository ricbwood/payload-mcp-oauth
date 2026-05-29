import crypto from 'crypto'

const DEV_PEPPER = 'dev-insecure-pepper-do-not-use-in-production-0000000'

function getPepper(): string {
  const pepper = process.env['PMOAUTH_TOKEN_PEPPER']
  if (pepper && pepper.length >= 32) return pepper
  if (process.env['NODE_ENV'] !== 'production') return DEV_PEPPER
  throw new Error(
    '[payload-plugin-mcp-oauth] PMOAUTH_TOKEN_PEPPER is missing or too short. ' +
      'In production this env var must be at least 32 characters. ' +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
  )
}

export function hashToken(plaintext: string): string {
  return crypto.createHmac('sha256', getPepper()).update(plaintext).digest('hex')
}

export function compareTokenHash(plaintext: string, storedHash: string): boolean {
  const computed = Buffer.from(hashToken(plaintext), 'hex')
  const stored = Buffer.from(storedHash, 'hex')

  // Lengths should always be equal (both are SHA-256 hex = 64 chars / 32 bytes),
  // but guard against malformed stored values without leaking timing.
  if (computed.length !== stored.length) {
    crypto.timingSafeEqual(computed, computed)
    return false
  }

  return crypto.timingSafeEqual(computed, stored)
}
