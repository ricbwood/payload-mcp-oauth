import { beforeEach, describe, expect, it, vi } from 'vitest'
import { issueTokenPair, rotateRefreshToken } from '../../../src/lib/tokens.js'

process.env['PMOAUTH_TOKEN_PEPPER'] = 'test-pepper-32-chars-minimum-length!!'

function makePayload(overrides: Record<string, unknown> = {}) {
  return {
    create: vi.fn().mockResolvedValue({ id: 'token-doc-1' }),
    find: vi.fn().mockResolvedValue({ docs: [] }),
    update: vi.fn().mockResolvedValue({ id: 'token-doc-1' }),
    ...overrides,
  }
}

const BASE_PARAMS = {
  clientId: 'client-1',
  userId: 'user-1',
  scope: 'posts:read',
  capabilities: { posts: { find: true } },
}

describe('issueTokenPair', () => {
  it('creates two documents (access + refresh) and returns a token pair', async () => {
    const payload = makePayload()
    const pair = await issueTokenPair(payload as never, BASE_PARAMS)

    expect(payload.create).toHaveBeenCalledTimes(2)
    expect(pair.access_token).toMatch(/^pmoauth_at_/)
    expect(pair.refresh_token).toMatch(/^pmoauth_rt_/)
    expect(pair.token_type).toBe('Bearer')
    expect(pair.expires_in).toBe(3600) // default 60 min
    expect(pair.scope).toBe('posts:read')
  })

  it('stores hashes — not plaintext tokens', async () => {
    const payload = makePayload()
    const pair = await issueTokenPair(payload as never, BASE_PARAMS)

    const calls = payload.create.mock.calls as Array<[{ data: Record<string, unknown> }]>
    const hashes = calls.map((c) => c[0]?.data?.tokenHash as string)
    expect(hashes[0]).not.toBe(pair.access_token)
    expect(hashes[1]).not.toBe(pair.refresh_token)
    expect(hashes[0]).toHaveLength(64)
    expect(hashes[1]).toHaveLength(64)
  })

  it('respects custom TTL options', async () => {
    const payload = makePayload()
    const pair = await issueTokenPair(payload as never, {
      ...BASE_PARAMS,
      accessTtlSeconds: 300,
    })
    expect(pair.expires_in).toBe(300)
  })
})

describe('rotateRefreshToken', () => {
  const activeToken = {
    id: 'refresh-doc-1',
    tokenHash: '', // will be ignored in mock
    tokenType: 'refresh',
    clientId: 'client-1',
    userId: 'user-1',
    scope: 'posts:read',
    capabilities: { posts: { find: true } },
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    revokedAt: null,
  }

  it('returns a new token pair and revokes the old refresh token', async () => {
    const payload = makePayload({
      find: vi.fn().mockResolvedValue({ docs: [activeToken] }),
    })
    const pair = await rotateRefreshToken(payload as never, 'pmoauth_rt_old', { clientId: 'client-1' })

    expect(pair).not.toBeNull()
    expect(pair?.access_token).toMatch(/^pmoauth_at_/)
    expect(pair?.refresh_token).toMatch(/^pmoauth_rt_/)
    // Old token should be revoked
    expect(payload.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'refresh-doc-1', data: expect.objectContaining({ revokedAt: expect.any(String) }) }),
    )
  })

  it('returns null for an unknown refresh token', async () => {
    const payload = makePayload()
    expect(await rotateRefreshToken(payload as never, 'pmoauth_rt_unknown', { clientId: 'c1' })).toBeNull()
  })

  it('returns null for an expired refresh token', async () => {
    const expired = { ...activeToken, expiresAt: new Date(Date.now() - 1000).toISOString() }
    const payload = makePayload({ find: vi.fn().mockResolvedValue({ docs: [expired] }) })
    expect(await rotateRefreshToken(payload as never, 'pmoauth_rt_exp', { clientId: 'c1' })).toBeNull()
  })

  it('triggers family revocation on reuse of a consumed token', async () => {
    const consumed = { ...activeToken, revokedAt: new Date().toISOString() }
    // First find returns the consumed token; second find (revokeAllForClientUser) returns active tokens
    const payload = makePayload({
      find: vi
        .fn()
        .mockResolvedValueOnce({ docs: [consumed] })
        .mockResolvedValueOnce({ docs: [{ id: 'at-1' }, { id: 'at-2' }] }),
    })

    const result = await rotateRefreshToken(payload as never, 'pmoauth_rt_reused', { clientId: 'c1' })
    expect(result).toBeNull()
    // Both active tokens should be revoked
    expect(payload.update).toHaveBeenCalledTimes(2)
  })
})
