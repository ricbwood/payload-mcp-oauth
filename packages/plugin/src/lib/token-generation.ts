import crypto from 'crypto'

export type TokenKind = 'access' | 'refresh' | 'code'

const KIND_PREFIX: Record<TokenKind, string> = {
  access: 'pmoauth_at_',
  refresh: 'pmoauth_rt_',
  code: 'pmoauth_ac_',
}

export const TOKEN_REGEX = /^pmoauth_(at|rt|ac)_[A-Za-z0-9_-]{43}$/

export function generateToken(kind: TokenKind): string {
  const prefix = KIND_PREFIX[kind]
  const entropy = crypto.randomBytes(32).toString('base64url')
  return `${prefix}${entropy}`
}
