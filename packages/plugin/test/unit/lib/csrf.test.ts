process.env['PMOAUTH_TOKEN_PEPPER'] = 'test-pepper-32-chars-minimum-length!!'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateCsrfNonce, storeCsrfNonce, consumeCsrfNonce, makeCsrfToken, verifyCsrfToken } from '../../../src/lib/csrf.js'

// The four values the consent CSRF token is bound to.
const P = ['user-1', 'client-1', 'https://app.example/cb', 'challenge-abc'] as const

afterEach(() => {
  vi.useRealTimers()
})

describe('generateCsrfNonce', () => {
  it('returns a 32-character hex string', () => {
    const nonce = generateCsrfNonce()
    expect(nonce).toMatch(/^[0-9a-f]{32}$/)
  })

  it('returns a different value on each call', () => {
    expect(generateCsrfNonce()).not.toBe(generateCsrfNonce())
  })
})

describe('storeCsrfNonce', () => {
  it('calls payload.create with hashed nonce for the given user', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'nonce-1' })
    const nonce = await storeCsrfNonce({ create } as never, 'user-42')
    expect(nonce).toMatch(/^[0-9a-f]{32}$/)
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'oauth-csrf-nonces',
        overrideAccess: true,
        data: expect.objectContaining({ userId: 'user-42' }),
      }),
    )
    // The stored nonceHash must NOT be the raw nonce (it is an HMAC)
    const stored = create.mock.calls[0][0] as { data: { nonceHash: string } }
    expect(stored.data.nonceHash).not.toBe(nonce)
  })
})

describe('consumeCsrfNonce', () => {
  it('returns true when update finds and marks the nonce consumed', async () => {
    const update = vi.fn().mockResolvedValue({ docs: [{ id: 'nonce-1' }] })
    expect(await consumeCsrfNonce({ update } as never, 'aabbccddeeff00112233445566778899', 'user-1')).toBe(true)
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'oauth-csrf-nonces',
        overrideAccess: true,
        data: expect.objectContaining({ consumedAt: expect.any(String) }),
      }),
    )
  })

  it('returns false when the nonce is already consumed or expired (docs is empty)', async () => {
    const update = vi.fn().mockResolvedValue({ docs: [] })
    expect(await consumeCsrfNonce({ update } as never, 'aabbccddeeff00112233445566778899', 'user-1')).toBe(false)
  })

  it('returns false for a non-string nonce without calling update', async () => {
    const update = vi.fn()
    for (const bad of [123, true, null, {}, undefined] as unknown[]) {
      expect(await consumeCsrfNonce({ update } as never, bad as never, 'u')).toBe(false)
    }
    expect(update).not.toHaveBeenCalled()
  })

  it('returns false for an over-long nonce without calling update', async () => {
    const update = vi.fn()
    expect(await consumeCsrfNonce({ update } as never, 'a'.repeat(65), 'u')).toBe(false)
    expect(update).not.toHaveBeenCalled()
  })
})

describe('makeCsrfToken', () => {
  it('returns a "<issuedAtMs>.<64-char hex HMAC>" token', () => {
    expect(makeCsrfToken(...P)).toMatch(/^\d+\.[0-9a-f]{64}$/)
  })

  it('embeds the supplied issuedAt timestamp', () => {
    expect(makeCsrfToken(...P, 1_700_000_000_000)).toMatch(/^1700000000000\.[0-9a-f]{64}$/)
  })

  it('is deterministic for the same inputs and issuedAt', () => {
    expect(makeCsrfToken(...P, 1_700_000_000_000)).toBe(makeCsrfToken(...P, 1_700_000_000_000))
  })

  it('changes if ANY bound parameter changes', () => {
    const at = 1_700_000_000_000
    const base = makeCsrfToken(...P, at)
    expect(makeCsrfToken('other-user', P[1], P[2], P[3], at)).not.toBe(base)
    expect(makeCsrfToken(P[0], 'other-client', P[2], P[3], at)).not.toBe(base)
    expect(makeCsrfToken(P[0], P[1], 'https://evil/cb', P[3], at)).not.toBe(base)
    expect(makeCsrfToken(P[0], P[1], P[2], 'other-challenge', at)).not.toBe(base)
    expect(makeCsrfToken(P[0], P[1], P[2], P[3], at + 1)).not.toBe(base)
  })
})

describe('verifyCsrfToken', () => {
  it('accepts a freshly minted token for the same params', () => {
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

  it('rejects a same-length but tampered MAC', () => {
    const t = makeCsrfToken(...P)
    const dot = t.indexOf('.')
    const mac = t.slice(dot + 1)
    const flipped = t.slice(0, dot + 1) + (mac[0] === 'a' ? 'b' : 'a') + mac.slice(1)
    expect(verifyCsrfToken(flipped, ...P)).toBe(false)
  })

  it('rejects a token whose timestamp was tampered (timestamp is signed)', () => {
    const at = Date.now()
    const t = makeCsrfToken(...P, at)
    const mac = t.slice(t.indexOf('.') + 1)
    // Re-stamp with a different (still-fresh) timestamp but the original MAC.
    expect(verifyCsrfToken(`${at + 1}.${mac}`, ...P)).toBe(false)
  })

  it('rejects malformed tokens without throwing', () => {
    expect(verifyCsrfToken('nodot', ...P)).toBe(false)
    expect(verifyCsrfToken('.abcd', ...P)).toBe(false)
    expect(verifyCsrfToken('notanumber.deadbeef', ...P)).toBe(false)
    expect(verifyCsrfToken(`${Date.now()}.zzzznothex`, ...P)).toBe(false)
  })

  it('rejects a non-string token without throwing (body values are untrusted)', () => {
    // The param is typed string but comes from a parsed body, so a client can
    // make it a number/object/array/boolean. These must return false, not throw.
    for (const bad of [123, true, {}, [], { length: 9 }] as unknown[]) {
      expect(verifyCsrfToken(bad as never, ...P)).toBe(false)
    }
  })

  it('rejects an over-long timestamp segment without allocating', () => {
    // dot beyond a 13-digit ms timestamp (allowing slack to 15) is rejected.
    expect(verifyCsrfToken(`${'9'.repeat(20)}.${'a'.repeat(64)}`, ...P)).toBe(false)
  })

  it('rejects an expired token (older than the max age)', () => {
    const minted = makeCsrfToken(...P, Date.now())
    // Advance the clock past the 10-minute TTL.
    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + 11 * 60 * 1000)
    expect(verifyCsrfToken(minted, ...P)).toBe(false)
  })

  it('honours a custom max age', () => {
    const at = Date.now()
    const minted = makeCsrfToken(...P, at)
    vi.useFakeTimers()
    vi.setSystemTime(at + 5000)
    expect(verifyCsrfToken(minted, ...P, 10_000)).toBe(true)
    expect(verifyCsrfToken(minted, ...P, 1000)).toBe(false)
  })

  it('rejects a token minted in the future beyond clock skew', () => {
    const future = makeCsrfToken(...P, Date.now() + 5 * 60 * 1000)
    expect(verifyCsrfToken(future, ...P)).toBe(false)
  })
})
