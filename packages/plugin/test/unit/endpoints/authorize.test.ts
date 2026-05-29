import { describe, expect, it, vi } from 'vitest'
import { makeAuthorizeHandler } from '../../../src/endpoints/authorize.js'

const REGISTERED_URI = 'https://example.com/cb'
const VALID_CLIENT = {
  id: 'client-doc-1',
  clientId: 'client-1',
  clientName: 'Test App',
  redirectUris: [{ uri: REGISTERED_URI }],
  isActive: true,
}

function makeReq(query: Record<string, string | undefined>, user: unknown = null) {
  return {
    method: 'GET',
    query,
    user,
    url: '/api/oauth/authorize',
    headers: new Headers(),
    payload: {
      find: vi.fn().mockResolvedValue({ docs: [VALID_CLIENT] }),
    },
  }
}

const VALID_QUERY = {
  response_type: 'code',
  client_id: 'client-1',
  redirect_uri: REGISTERED_URI,
  code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  code_challenge_method: 'S256',
  state: 'random-state-value',
}

describe('makeAuthorizeHandler', () => {
  it('redirects unauthenticated users to login', async () => {
    const res = await makeAuthorizeHandler()(makeReq(VALID_QUERY, null) as never)
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toContain('/admin/login')
  })

  it('renders consent HTML for authenticated users', async () => {
    const res = await makeAuthorizeHandler()(makeReq(VALID_QUERY, { id: 'user-1' }) as never)
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('Test App')
    expect(res.headers.get('X-Frame-Options')).toBe('DENY')
  })

  it('rejects unsupported response_type with JSON error', async () => {
    const res = await makeAuthorizeHandler()(makeReq({ ...VALID_QUERY, response_type: 'token' }) as never)
    const body = await res.json() as Record<string, unknown>
    expect(body['error']).toBe('unsupported_response_type')
  })

  it('rejects missing client_id with JSON error', async () => {
    const req = makeReq({ ...VALID_QUERY, client_id: undefined })
    req.payload.find = vi.fn().mockResolvedValue({ docs: [] })
    const res = await makeAuthorizeHandler()(req as never)
    expect(((await res.json()) as Record<string, unknown>)['error']).toBe('invalid_request')
  })

  it('rejects unknown client_id with JSON error', async () => {
    const req = makeReq({ ...VALID_QUERY, client_id: 'unknown' })
    req.payload.find = vi.fn().mockResolvedValue({ docs: [] })
    const res = await makeAuthorizeHandler()(req as never)
    expect(((await res.json()) as Record<string, unknown>)['error']).toBe('invalid_client')
  })

  it('rejects open-redirect attempt — no Location header to attacker', async () => {
    const res = await makeAuthorizeHandler()(
      makeReq({ ...VALID_QUERY, redirect_uri: 'https://attacker.example.com/steal' }) as never,
    )
    const body = await res.json() as Record<string, unknown>
    expect(body['error']).toBe('invalid_redirect_uri')
    expect(res.headers.get('Location')).toBeNull()
  })

  it('redirects error to redirect_uri when missing code_challenge', async () => {
    const res = await makeAuthorizeHandler()(
      makeReq({ ...VALID_QUERY, code_challenge: undefined }, { id: 'u1' }) as never,
    )
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toContain('error=invalid_request')
  })

  it('rejects plain code_challenge_method', async () => {
    const res = await makeAuthorizeHandler()(
      makeReq({ ...VALID_QUERY, code_challenge_method: 'plain' }, { id: 'u1' }) as never,
    )
    expect(res.headers.get('Location')).toContain('error=invalid_request')
  })

  it('rejects missing state', async () => {
    const res = await makeAuthorizeHandler()(
      makeReq({ ...VALID_QUERY, state: undefined }, { id: 'u1' }) as never,
    )
    expect(res.headers.get('Location')).toContain('error=invalid_request')
  })

  it('sets security headers on consent HTML', async () => {
    const res = await makeAuthorizeHandler()(makeReq(VALID_QUERY, { id: 'user-1' }) as never)
    expect(res.headers.get('Content-Security-Policy')).toBeTruthy()
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer')
  })
})
