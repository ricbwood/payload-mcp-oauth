import crypto from 'crypto'
import { describe, expect, it } from 'vitest'
import { PkceError, validateCodeChallenge, validateCodeVerifier, verifyPkce } from '../../../src/lib/pkce.js'

// RFC 7636 §Appendix B test vector
const RFC_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
const RFC_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'

function makeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url')
}

describe('verifyPkce', () => {
  it('accepts the RFC 7636 test vector', () => {
    expect(verifyPkce(RFC_VERIFIER, RFC_CHALLENGE, 'S256')).toBe(true)
  })

  it('returns true for a freshly generated verifier/challenge pair', () => {
    const verifier = crypto.randomBytes(32).toString('base64url')
    const challenge = makeChallenge(verifier)
    expect(verifyPkce(verifier, challenge, 'S256')).toBe(true)
  })

  it('returns false for a wrong verifier', () => {
    const challenge = makeChallenge('correct-verifier')
    expect(verifyPkce('wrong-verifier', challenge, 'S256')).toBe(false)
  })

  it('returns false for a tampered challenge', () => {
    const verifier = 'some-verifier-string'
    expect(verifyPkce(verifier, 'tampered-challenge-value', 'S256')).toBe(false)
  })

  it('throws PkceError for plain method', () => {
    expect(() => verifyPkce('verifier', 'challenge', 'plain')).toThrow(PkceError)
    expect(() => verifyPkce('verifier', 'challenge', 'plain')).toThrow(/plain/)
  })

  it('throws PkceError for any unsupported method', () => {
    expect(() => verifyPkce('verifier', 'challenge', 'RS256')).toThrow(PkceError)
    expect(() => verifyPkce('verifier', 'challenge', '')).toThrow(PkceError)
  })

  it('PkceError has the correct code', () => {
    try {
      verifyPkce('v', 'c', 'plain')
    } catch (e) {
      expect(e).toBeInstanceOf(PkceError)
      expect((e as PkceError).code).toBe('PKCE_METHOD_NOT_SUPPORTED')
    }
  })

  it('returns false when challenge has wrong length', () => {
    // SHA-256 output is 32 bytes → 43 base64url chars; a shorter challenge should fail
    expect(verifyPkce('verifier', 'tooshort', 'S256')).toBe(false)
  })
})

describe('validateCodeVerifier', () => {
  it('accepts a 43-char verifier with unreserved chars', () => {
    expect(validateCodeVerifier('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(true)
  })

  it('accepts a 128-char verifier', () => {
    const v = 'A'.repeat(128)
    expect(validateCodeVerifier(v)).toBe(true)
  })

  it('rejects a 42-char verifier (too short)', () => {
    expect(validateCodeVerifier('A'.repeat(42))).toBe(false)
  })

  it('rejects a 129-char verifier (too long)', () => {
    expect(validateCodeVerifier('A'.repeat(129))).toBe(false)
  })

  it('rejects verifier with disallowed chars (base64 padding)', () => {
    // '=' is not in the RFC 7636 unreserved set
    const v = 'A'.repeat(42) + '='
    expect(validateCodeVerifier(v)).toBe(false)
  })

  it('rejects verifier with spaces', () => {
    expect(validateCodeVerifier('A'.repeat(42) + ' ')).toBe(false)
  })

  it('rejects non-string input', () => {
    expect(validateCodeVerifier(123 as unknown as string)).toBe(false)
  })
})

describe('validateCodeChallenge', () => {
  it('accepts the RFC 7636 test vector challenge (43 base64url chars)', () => {
    expect(validateCodeChallenge('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')).toBe(true)
  })

  it('rejects a 42-char challenge (too short)', () => {
    expect(validateCodeChallenge('A'.repeat(42))).toBe(false)
  })

  it('rejects a 44-char challenge (too long / with padding)', () => {
    expect(validateCodeChallenge('A'.repeat(44))).toBe(false)
  })

  it('rejects challenge with base64 padding char', () => {
    expect(validateCodeChallenge('A'.repeat(42) + '=')).toBe(false)
  })

  it('rejects non-string input', () => {
    expect(validateCodeChallenge(null as unknown as string)).toBe(false)
  })
})
