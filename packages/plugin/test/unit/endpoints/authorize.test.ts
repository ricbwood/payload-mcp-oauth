import { describe, expect, it, vi } from 'vitest'
import { makeAuthorizeHandler } from '../../../src/endpoints/authorize.js'
import { verifyCsrfToken } from '../../../src/lib/csrf.js'

process.env['PMOAUTH_TOKEN_PEPPER'] = 'test-pepper-32-chars-minimum-length!!'

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

  it('discloses that approval grants all enabled tools (consent integrity, no per-scope narrowing yet)', async () => {
    // The token is granted the operator-configured capability set regardless of the
    // requested scope (see issue #35). The consent screen must say so plainly rather
    // than implying the listed scopes bound the grant.
    const res = await makeAuthorizeHandler()(makeReq(VALID_QUERY, { id: 'user-1' }) as never)
    const html = await res.text()
    expect(html).toMatch(/acting as you/i)
    expect(html).toMatch(/all tools enabled on this server/i)
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

  it('renders consent HTML when state is absent (state is optional per OAuth 2.1)', async () => {
    const res = await makeAuthorizeHandler()(
      makeReq({ ...VALID_QUERY, state: undefined }, { id: 'u1' }) as never,
    )
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('Test App')
  })

  it('sets security headers on consent HTML', async () => {
    const res = await makeAuthorizeHandler()(makeReq(VALID_QUERY, { id: 'user-1' }) as never)
    expect(res.headers.get('Content-Security-Policy')).toBeTruthy()
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer')
  })

  it('embeds a server-signed CSRF token bound to user/client/redirect/challenge', async () => {
    const res = await makeAuthorizeHandler()(makeReq(VALID_QUERY, { id: 'user-1' }) as never)
    const html = await res.text()
    const m = html.match(/name="csrf_token" value="([^"]+)"/)
    expect(m).not.toBeNull()
    const token = m![1] as string
    // The embedded token is time-bound and must validate for the bound params...
    expect(verifyCsrfToken(token, 'user-1', VALID_QUERY.client_id, REGISTERED_URI, VALID_QUERY.code_challenge)).toBe(true)
    // ...but not for a different user (no cross-user consent).
    expect(verifyCsrfToken(token, 'other-user', VALID_QUERY.client_id, REGISTERED_URI, VALID_QUERY.code_challenge)).toBe(false)
  })

  it('uses the configured consentPath as the form action', async () => {
    const res = await makeAuthorizeHandler('/admin', undefined, '/cms/oauth/consent')(
      makeReq(VALID_QUERY, { id: 'user-1' }) as never,
    )
    const html = await res.text()
    expect(html).toContain('action="/cms/oauth/consent"')
    expect(html).not.toContain('action="/api/oauth/consent"')
  })
})
