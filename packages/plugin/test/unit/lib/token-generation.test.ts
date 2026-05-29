import { describe, expect, it } from 'vitest'
import { TOKEN_REGEX, generateToken } from '../../../src/lib/token-generation.js'

describe('generateToken', () => {
  it.each([
    ['access', 'pmoauth_at_'],
    ['refresh', 'pmoauth_rt_'],
    ['code', 'pmoauth_ac_'],
  ] as const)('generates a %s token with the correct prefix', (kind, prefix) => {
    const token = generateToken(kind)
    expect(token.startsWith(prefix)).toBe(true)
  })

  it('matches the TOKEN_REGEX format', () => {
    expect(TOKEN_REGEX.test(generateToken('access'))).toBe(true)
    expect(TOKEN_REGEX.test(generateToken('refresh'))).toBe(true)
    expect(TOKEN_REGEX.test(generateToken('code'))).toBe(true)
  })

  it('produces 43-character base64url entropy (32 bytes)', () => {
    // 32 bytes * (4/3) rounded up = 43 base64url chars
    const token = generateToken('access')
    const entropy = token.slice('pmoauth_at_'.length)
    expect(entropy).toHaveLength(43)
    expect(entropy).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('never produces the same token in 100k iterations', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 100_000; i++) {
      const t = generateToken('access')
      expect(seen.has(t)).toBe(false)
      seen.add(t)
    }
  })

  it('tokens of different kinds do not collide', () => {
    const a = generateToken('access')
    const r = generateToken('refresh')
    const c = generateToken('code')
    expect(a).not.toBe(r)
    expect(a).not.toBe(c)
    expect(r).not.toBe(c)
  })
})
