import { describe, expect, it, vi } from 'vitest'
import { validateAccessToken } from '../../../src/lib/validate.js'
import { hashToken } from '../../../src/lib/token-storage.js'

process.env['PMOAUTH_TOKEN_PEPPER'] = 'test-pepper-32-chars-minimum-length!!'

function makePayload(overrides: Record<string, unknown> = {}) {
  return {
    find: vi.fn().mockResolvedValue({ docs: [] }),
    update: vi.fn().mockResolvedValue({}),
    ...overrides,
  }
}

const VALID_TOKEN = 'pmoauth_at_Rv8xKq3mN2pLs9nW4tF2qMr6kB1uJ7p_ab'

function makeTokenDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tok-1',
    tokenHash: hashToken(VALID_TOKEN),
    tokenType: 'access',
    clientId: 'client-1',
    userId: 'user-1',
    scope: 'posts:read',
    capabilities: { posts: { find: true } },
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    revokedAt: null,
    ...overrides,
  }
}

describe('validateAccessToken', () => {
  it('returns TokenContext for a valid token', async () => {
    const payload = makePayload({
      find: vi.fn().mockResolvedValue({ docs: [makeTokenDoc()] }),
    })

    const ctx = await validateAccessToken(payload as never, VALID_TOKEN)

    expect(ctx).not.toBeNull()
    expect(ctx?.userId).toBe('user-1')
    expect(ctx?.clientId).toBe('client-1')
    expect(ctx?.scope).toBe('posts:read')
    expect(ctx?.capabilities).toEqual({ posts: { find: true } })
  })

  it('returns null for a token not starting with pmoauth_at_', async () => {
    const payload = makePayload()
    expect(await validateAccessToken(payload as never, 'pmoauth_rt_somerefresh')).toBeNull()
    expect(await validateAccessToken(payload as never, 'some-api-key')).toBeNull()
    expect(payload.find).not.toHaveBeenCalled()
  })

  it('returns null when the token hash is not found', async () => {
    const payload = makePayload()
    expect(await validateAccessToken(payload as never, VALID_TOKEN)).toBeNull()
  })

  it('returns null for a revoked token', async () => {
    const payload = makePayload({
      find: vi.fn().mockResolvedValue({
        docs: [makeTokenDoc({ revokedAt: new Date().toISOString() })],
      }),
    })
    expect(await validateAccessToken(payload as never, VALID_TOKEN)).toBeNull()
  })

  it('returns null for an expired token (beyond clock skew)', async () => {
    const payload = makePayload({
      find: vi.fn().mockResolvedValue({
        docs: [makeTokenDoc({ expiresAt: new Date(Date.now() - 31_000).toISOString() })],
      }),
    })
    expect(await validateAccessToken(payload as never, VALID_TOKEN)).toBeNull()
  })

  it('accepts a token within the 30-second clock skew window', async () => {
    const payload = makePayload({
      find: vi.fn().mockResolvedValue({
        docs: [makeTokenDoc({ expiresAt: new Date(Date.now() - 10_000).toISOString() })],
      }),
    })
    expect(await validateAccessToken(payload as never, VALID_TOKEN)).not.toBeNull()
  })

  it('fires a best-effort lastUsedAt update without awaiting', async () => {
    const updateFn = vi.fn().mockResolvedValue({})
    const payload = makePayload({
      find: vi.fn().mockResolvedValue({ docs: [makeTokenDoc()] }),
      update: updateFn,
    })

    await validateAccessToken(payload as never, VALID_TOKEN)
    // Give the microtask queue a tick to process the fire-and-forget update
    await Promise.resolve()
    expect(updateFn).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ lastUsedAt: expect.any(String) }) }),
    )
  })

  it('does not throw when the lastUsedAt update fails', async () => {
    const payload = makePayload({
      find: vi.fn().mockResolvedValue({ docs: [makeTokenDoc()] }),
      update: vi.fn().mockRejectedValue(new Error('DB error')),
    })
    await expect(validateAccessToken(payload as never, VALID_TOKEN)).resolves.not.toBeNull()
  })
})
