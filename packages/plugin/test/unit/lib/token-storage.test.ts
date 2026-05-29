import crypto from 'crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { compareTokenHash, hashToken } from '../../../src/lib/token-storage.js'

const TEST_PEPPER = 'test-pepper-32-chars-minimum-length!!'

beforeEach(() => {
  process.env['PMOAUTH_TOKEN_PEPPER'] = TEST_PEPPER
})

afterEach(() => {
  delete process.env['PMOAUTH_TOKEN_PEPPER']
})

describe('hashToken', () => {
  it('returns a 64-character hex string (SHA-256 output)', () => {
    const result = hashToken('pmoauth_at_sometoken')
    expect(result).toHaveLength(64)
    expect(result).toMatch(/^[0-9a-f]+$/)
  })

  it('is deterministic — same input produces same hash', () => {
    const token = 'pmoauth_rt_abc123'
    expect(hashToken(token)).toBe(hashToken(token))
  })

  it('produces different hashes for different inputs', () => {
    expect(hashToken('token-a')).not.toBe(hashToken('token-b'))
  })

  it('matches the expected HMAC-SHA-256 value', () => {
    const expected = crypto.createHmac('sha256', TEST_PEPPER).update('known-token').digest('hex')
    expect(hashToken('known-token')).toBe(expected)
  })

  it('is sensitive to the pepper — different pepper gives different hash', () => {
    const hash1 = hashToken('same-token')

    process.env['PMOAUTH_TOKEN_PEPPER'] = 'different-pepper-32-chars-minimum!!'
    const hash2 = hashToken('same-token')

    expect(hash1).not.toBe(hash2)
  })

  it('throws in production when pepper is missing', () => {
    delete process.env['PMOAUTH_TOKEN_PEPPER']
    const original = process.env['NODE_ENV']
    process.env['NODE_ENV'] = 'production'

    try {
      expect(() => hashToken('token')).toThrow(/PMOAUTH_TOKEN_PEPPER/)
    } finally {
      process.env['NODE_ENV'] = original
      process.env['PMOAUTH_TOKEN_PEPPER'] = TEST_PEPPER
    }
  })

  it('throws in production when pepper is shorter than 32 characters', () => {
    process.env['PMOAUTH_TOKEN_PEPPER'] = 'short'
    const original = process.env['NODE_ENV']
    process.env['NODE_ENV'] = 'production'

    try {
      expect(() => hashToken('token')).toThrow(/PMOAUTH_TOKEN_PEPPER/)
    } finally {
      process.env['NODE_ENV'] = original
      process.env['PMOAUTH_TOKEN_PEPPER'] = TEST_PEPPER
    }
  })

  it('uses the dev pepper in non-production when env var is absent', () => {
    delete process.env['PMOAUTH_TOKEN_PEPPER']
    const original = process.env['NODE_ENV']
    process.env['NODE_ENV'] = 'development'

    try {
      expect(() => hashToken('token')).not.toThrow()
    } finally {
      process.env['NODE_ENV'] = original
      process.env['PMOAUTH_TOKEN_PEPPER'] = TEST_PEPPER
    }
  })
})

describe('compareTokenHash', () => {
  it('returns true when plaintext matches the stored hash', () => {
    const token = 'pmoauth_at_validtoken'
    const hash = hashToken(token)
    expect(compareTokenHash(token, hash)).toBe(true)
  })

  it('returns false when plaintext does not match', () => {
    const hash = hashToken('correct-token')
    expect(compareTokenHash('wrong-token', hash)).toBe(false)
  })

  it('returns false for an empty plaintext against a real hash', () => {
    const hash = hashToken('pmoauth_at_something')
    expect(compareTokenHash('', hash)).toBe(false)
  })

  it('returns false when stored hash is malformed (wrong length)', () => {
    expect(compareTokenHash('pmoauth_at_token', 'not-a-real-hash')).toBe(false)
  })

  it('round-trips correctly across multiple tokens', () => {
    const tokens = Array.from({ length: 10 }, (_, i) => `pmoauth_at_token${i}`)
    tokens.forEach((token) => {
      const hash = hashToken(token)
      expect(compareTokenHash(token, hash)).toBe(true)
      expect(compareTokenHash(`${token}-tampered`, hash)).toBe(false)
    })
  })
})
