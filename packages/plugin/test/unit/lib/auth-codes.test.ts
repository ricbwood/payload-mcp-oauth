import crypto from 'crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { consumeAuthCode, issueAuthCode } from '../../../src/lib/auth-codes.js'

process.env['PMOAUTH_TOKEN_PEPPER'] = 'test-pepper-32-chars-minimum-length!!'

function makeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url')
}

function makePayload(overrides: Record<string, unknown> = {}) {
  return {
    create: vi.fn().mockResolvedValue({ id: 'code-doc-1' }),
    find: vi.fn().mockResolvedValue({ docs: [] }),
    update: vi.fn().mockResolvedValue({ id: 'code-doc-1' }),
    ...overrides,
  }
}

describe('issueAuthCode', () => {
  it('creates a document in oauth-auth-codes', async () => {
    const payload = makePayload()
    const code = await issueAuthCode(payload as never, {
      clientId: 'client-1',
      userId: 'user-1',
      redirectUri: 'https://example.com/cb',
      scope: 'posts:read',
      codeChallenge: makeChallenge('verifier'),
      codeChallengeMethod: 'S256',
    })

    expect(payload.create).toHaveBeenCalledWith(
      expect.objectContaining({ collection: 'oauth-auth-codes' }),
    )
    expect(code).toMatch(/^pmoauth_ac_/)
  })

  it('stores a hash — not the plaintext', async () => {
    const payload = makePayload()
    const code = await issueAuthCode(payload as never, {
      clientId: 'c1',
      userId: 'u1',
      redirectUri: 'https://cb.example.com',
      scope: '',
      codeChallenge: makeChallenge('v'),
      codeChallengeMethod: 'S256',
    })

    const createArg = payload.create.mock.calls[0]?.[0] as { data: Record<string, unknown> }
    expect(createArg?.data?.codeHash).not.toBe(code)
    expect(createArg?.data?.codeHash).toHaveLength(64) // SHA-256 hex
  })
})

describe('consumeAuthCode', () => {
  const verifier = 'my-secure-verifier-string-of-reasonable-length'
  const challenge = makeChallenge(verifier)
  const baseParams = { clientId: 'client-1', redirectUri: 'https://example.com/cb', codeVerifier: verifier }

  function makeCodeDoc(overrides: Record<string, unknown> = {}) {
    return {
      id: 'doc-1',
      clientId: 'client-1',
      userId: 'user-1',
      redirectUri: 'https://example.com/cb',
      scope: 'posts:read',
      codeChallenge: challenge,
      codeChallengeMethod: 'S256',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      consumedAt: null,
      ...overrides,
    }
  }

  it('returns the auth code context on success', async () => {
    const payload = makePayload({
      find: vi.fn().mockResolvedValue({ docs: [makeCodeDoc()] }),
    })

    const result = await consumeAuthCode(payload as never, 'pmoauth_ac_sometoken', baseParams)
    expect(result).not.toBeNull()
    expect(result?.clientId).toBe('client-1')
    expect(result?.userId).toBe('user-1')
    expect(payload.update).toHaveBeenCalledOnce()
  })

  it('returns null for an unknown code', async () => {
    const payload = makePayload()
    expect(await consumeAuthCode(payload as never, 'pmoauth_ac_unknown', baseParams)).toBeNull()
  })

  it('returns null for an already-consumed code (double-spend)', async () => {
    const payload = makePayload({
      find: vi.fn().mockResolvedValue({ docs: [makeCodeDoc({ consumedAt: new Date().toISOString() })] }),
    })
    expect(await consumeAuthCode(payload as never, 'pmoauth_ac_used', baseParams)).toBeNull()
    expect(payload.update).not.toHaveBeenCalled()
  })

  it('returns null for an expired code', async () => {
    const payload = makePayload({
      find: vi.fn().mockResolvedValue({
        docs: [makeCodeDoc({ expiresAt: new Date(Date.now() - 1000).toISOString() })],
      }),
    })
    expect(await consumeAuthCode(payload as never, 'pmoauth_ac_expired', baseParams)).toBeNull()
  })

  it('returns null when clientId does not match', async () => {
    const payload = makePayload({
      find: vi.fn().mockResolvedValue({ docs: [makeCodeDoc({ clientId: 'other-client' })] }),
    })
    expect(await consumeAuthCode(payload as never, 'pmoauth_ac_t', baseParams)).toBeNull()
  })

  it('returns null when redirectUri does not match', async () => {
    const payload = makePayload({
      find: vi.fn().mockResolvedValue({
        docs: [makeCodeDoc({ redirectUri: 'https://attacker.example.com/cb' })],
      }),
    })
    expect(await consumeAuthCode(payload as never, 'pmoauth_ac_t', baseParams)).toBeNull()
  })

  it('returns null when PKCE verifier is wrong', async () => {
    const payload = makePayload({
      find: vi.fn().mockResolvedValue({ docs: [makeCodeDoc()] }),
    })
    const badParams = { ...baseParams, codeVerifier: 'wrong-verifier' }
    expect(await consumeAuthCode(payload as never, 'pmoauth_ac_t', badParams)).toBeNull()
  })
})
