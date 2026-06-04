process.env['PMOAUTH_TOKEN_PEPPER'] = 'test-pepper-32-chars-minimum-length!!'

import { describe, expect, it } from 'vitest'
import { makeCsrfToken, verifyCsrfToken } from '../../../src/lib/csrf.js'

// The four values the consent CSRF token is bound to.
const P = ['user-1', 'client-1', 'https://app.example/cb', 'challenge-abc'] as const

describe('makeCsrfToken', () => {
  it('returns a 64-char hex HMAC', () => {
    expect(makeCsrfToken(...P)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is deterministic for the same inputs', () => {
    expect(makeCsrfToken(...P)).toBe(makeCsrfToken(...P))
  })

  it('changes if ANY bound parameter changes', () => {
    const base = makeCsrfToken(...P)
    expect(makeCsrfToken('other-user', P[1], P[2], P[3])).not.toBe(base)
    expect(makeCsrfToken(P[0], 'other-client', P[2], P[3])).not.toBe(base)
    expect(makeCsrfToken(P[0], P[1], 'https://evil/cb', P[3])).not.toBe(base)
    expect(makeCsrfToken(P[0], P[1], P[2], 'other-challenge')).not.toBe(base)
  })
})

describe('verifyCsrfToken', () => {
  it('accepts a token it minted for the same params', () => {
    expect(verifyCsrfToken(makeCsrfToken(...P), ...P)).toBe(true)
  })

  it('rejects an undefined or empty token', () => {
    expect(verifyCsrfToken(undefined, ...P)).toBe(false)
    expect(verifyCsrfToken('', ...P)).toBe(false)
  })

  it('rejects a token bound to different params (no cross-use / forged consent)', () => {
    const t = makeCsrfToken(...P)
    expect(verifyCsrfToken(t, 'attacker', P[1], P[2], P[3])).toBe(false)
    expect(verifyCsrfToken(t, P[0], 'other-client', P[2], P[3])).toBe(false)
    expect(verifyCsrfToken(t, P[0], P[1], 'https://evil/cb', P[3])).toBe(false)
    expect(verifyCsrfToken(t, P[0], P[1], P[2], 'tampered-challenge')).toBe(false)
  })

  it('rejects a same-length but tampered token', () => {
    const t = makeCsrfToken(...P)
    const flipped = (t[0] === 'a' ? 'b' : 'a') + t.slice(1)
    expect(flipped).toHaveLength(t.length)
    expect(verifyCsrfToken(flipped, ...P)).toBe(false)
  })

  it('rejects non-hex or wrong-length tokens without throwing', () => {
    expect(verifyCsrfToken('zzzznothex', ...P)).toBe(false)
    expect(verifyCsrfToken('abcd', ...P)).toBe(false) // valid hex, wrong length
  })
})
