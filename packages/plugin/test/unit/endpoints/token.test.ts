import crypto from 'crypto'
import { describe, expect, it, vi } from 'vitest'
import { makeTokenHandler } from '../../../src/endpoints/token.js'
import { hashToken } from '../../../src/lib/token-storage.js'

process.env['PMOAUTH_TOKEN_PEPPER'] = 'test-pepper-32-chars-minimum-length!!'

const VERIFIER = 'my-secure-pkce-verifier-string-length-ok'
const CHALLENGE = crypto.createHash('sha256').update(VERIFIER).digest('base64url')
const VALID_REFRESH = 'pmoauth_rt_Rv8xKq3mN2pLs9nW4tF2qMr6kB1uJ7pabc'

function makeCodeDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: 'code-doc-1',
    clientId: 'client-1',
    userId: 'user-1',
    redirectUri: 'https://example.com/cb',
    scope: 'posts:read',
    codeChallenge: CHALLENGE,
    codeChallengeMethod: 'S256',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    consumedAt: null,
    ...overrides,
  }
}

function makeRefreshDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: 'refresh-doc-1',
    tokenHash: hashToken(VALID_REFRESH),
    tokenType: 'refresh',
    clientId: 'client-1',
    userId: 'user-1',
    scope: 'posts:read',
    capabilities: {},
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    revokedAt: null,
    ...overrides,
  }
}

function makeReq(body: unknown, findDocs: unknown[] = [], method = 'POST') {
  return {
    method,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn(),
    payload: {
      find: vi.fn().mockResolvedValue({ docs: findDocs }),
      create: vi.fn().mockResolvedValue({ id: 'new-doc' }),
      update: vi.fn().mockResolvedValue({}),
    },
  }
}

describe('makeTokenHandler — authorization_code grant', () => {
  it('returns a token pair on valid auth code exchange', async () => {
    const authCode = 'pmoauth_ac_' + crypto.randomBytes(32).toString('base64url')
    const req = makeReq(
      { grant_type: 'authorization_code', code: authCode, client_id: 'client-1', redirect_uri: 'https://example.com/cb', code_verifier: VERIFIER },
      [makeCodeDoc()],
    )
    const res = await makeTokenHandler()(req as never)
    expect(res.status).toBe(200)
    const b = await res.json() as Record<string, unknown>
    expect(b['access_token']).toMatch(/^pmoauth_at_/)
    expect(b['refresh_token']).toMatch(/^pmoauth_rt_/)
  })

  it('returns invalid_grant for bad code', async () => {
    const req = makeReq(
      { grant_type: 'authorization_code', code: 'pmoauth_ac_bad', client_id: 'c1', redirect_uri: 'https://a.com', code_verifier: 'v' },
      [],
    )
    const res = await makeTokenHandler()(req as never)
    expect(res.status).toBe(400)
    expect(((await res.json()) as Record<string, unknown>)['error']).toBe('invalid_grant')
  })

  it('returns invalid_request when required fields missing', async () => {
    const req = makeReq({ grant_type: 'authorization_code', code: 'pmoauth_ac_x' }, [])
    const res = await makeTokenHandler()(req as never)
    expect(res.status).toBe(400)
    expect(((await res.json()) as Record<string, unknown>)['error']).toBe('invalid_request')
  })
})

describe('makeTokenHandler — refresh_token grant', () => {
  it('returns a new token pair on valid refresh', async () => {
    const req = makeReq(
      { grant_type: 'refresh_token', refresh_token: VALID_REFRESH, client_id: 'client-1' },
      [makeRefreshDoc()],
    )
    const res = await makeTokenHandler()(req as never)
    expect(res.status).toBe(200)
    expect(((await res.json()) as Record<string, unknown>)['access_token']).toMatch(/^pmoauth_at_/)
  })

  it('returns invalid_grant for expired refresh token', async () => {
    const req = makeReq(
      { grant_type: 'refresh_token', refresh_token: VALID_REFRESH, client_id: 'client-1' },
      [makeRefreshDoc({ expiresAt: new Date(Date.now() - 1000).toISOString() })],
    )
    const res = await makeTokenHandler()(req as never)
    expect(res.status).toBe(400)
    expect(((await res.json()) as Record<string, unknown>)['error']).toBe('invalid_grant')
  })

  it('returns invalid_request when refresh_token missing', async () => {
    const req = makeReq({ grant_type: 'refresh_token', client_id: 'c1' }, [])
    const res = await makeTokenHandler()(req as never)
    expect(res.status).toBe(400)
  })
})

describe('makeTokenHandler — edge cases', () => {
  it('returns unsupported_grant_type for unknown grant', async () => {
    const req = makeReq({ grant_type: 'client_credentials' }, [])
    const res = await makeTokenHandler()(req as never)
    expect(res.status).toBe(400)
    expect(((await res.json()) as Record<string, unknown>)['error']).toBe('unsupported_grant_type')
  })

  it('returns invalid_request when grant_type is absent', async () => {
    const req = makeReq({}, [])
    const res = await makeTokenHandler()(req as never)
    expect(res.status).toBe(400)
    expect(((await res.json()) as Record<string, unknown>)['error']).toBe('invalid_request')
  })

  it('returns 405 for non-POST', async () => {
    const req = makeReq({}, [], 'GET')
    const res = await makeTokenHandler()(req as never)
    expect(res.status).toBe(405)
  })
})
