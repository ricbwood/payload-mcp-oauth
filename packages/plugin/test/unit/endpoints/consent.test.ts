import { describe, expect, it, vi } from 'vitest'
import { makeConsentHandler } from '../../../src/endpoints/consent.js'
import { makeCsrfToken } from '../../../src/lib/csrf.js'

process.env['PMOAUTH_TOKEN_PEPPER'] = 'test-pepper-32-chars-minimum-length!!'

const REGISTERED_URI = 'https://example.com/cb'
const CODE_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'

const VALID_CLIENT = {
  id: 'client-doc-1',
  clientId: 'client-1',
  redirectUris: [{ uri: REGISTERED_URI }],
  isActive: true,
}

const VALID_BODY = {
  decision: 'approve',
  client_id: 'client-1',
  redirect_uri: REGISTERED_URI,
  code_challenge: CODE_CHALLENGE,
  code_challenge_method: 'S256',
  state: 'csrf-state',
  user_id: 'user-1',
  scope: 'posts:read',
  csrf_token: makeCsrfToken('user-1', 'client-1', REGISTERED_URI, CODE_CHALLENGE),
}

function makeReq(body: unknown, method = 'POST') {
  return {
    method,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn(),
    payload: {
      find: vi.fn().mockResolvedValue({ docs: [VALID_CLIENT] }),
      create: vi.fn().mockResolvedValue({ id: 'code-doc-1' }),
    },
  }
}

describe('makeConsentHandler', () => {
  it('redirects with code on approval', async () => {
    const res = await makeConsentHandler()(makeReq(VALID_BODY) as never)
    expect(res.status).toBe(302)
    const location = res.headers.get('Location') ?? ''
    expect(location).toContain('code=pmoauth_ac_')
    expect(location).toContain('state=csrf-state')
  })

  it('redirects with access_denied on denial per RFC 6749 §4.1.2.1', async () => {
    const req = makeReq({ ...VALID_BODY, decision: 'deny' })
    const res = await makeConsentHandler()(req as never)
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toContain('error=access_denied')
    expect(res.headers.get('Location')).toContain('state=csrf-state')
    expect(req.payload.create).not.toHaveBeenCalled()
  })

  it('returns 400 for unknown decision', async () => {
    const res = await makeConsentHandler()(makeReq({ ...VALID_BODY, decision: 'maybe' }) as never)
    expect(res.status).toBe(400)
  })

  it('returns 400 when required fields are missing', async () => {
    const res = await makeConsentHandler()(makeReq({ decision: 'approve' }) as never)
    expect(res.status).toBe(400)
  })

  it('returns 400 for unknown client_id', async () => {
    const req = makeReq(VALID_BODY)
    req.payload.find = vi.fn().mockResolvedValue({ docs: [] })
    const res = await makeConsentHandler()(req as never)
    expect(res.status).toBe(400)
    expect(((await res.json()) as Record<string, unknown>)['error']).toBe('invalid_client')
  })

  it('returns 400 when redirect_uri is not registered', async () => {
    const res = await makeConsentHandler()(
      makeReq({ ...VALID_BODY, redirect_uri: 'https://attacker.example.com/steal' }) as never,
    )
    expect(res.status).toBe(400)
  })

  it('returns 405 for non-POST', async () => {
    const res = await makeConsentHandler()(makeReq(VALID_BODY, 'GET') as never)
    expect(res.status).toBe(405)
  })

  it('issues code without state when state is absent (state is optional per OAuth 2.1)', async () => {
    const { state: _omit, ...bodyWithoutState } = VALID_BODY
    const res = await makeConsentHandler()(makeReq(bodyWithoutState) as never)
    expect(res.status).toBe(302)
    const location = res.headers.get('Location') ?? ''
    expect(location).toContain('code=pmoauth_ac_')
    expect(location).not.toContain('state=')
  })

  it('rejects missing csrf_token with 400', async () => {
    const { csrf_token: _omit, ...bodyWithoutCsrf } = VALID_BODY
    const res = await makeConsentHandler()(makeReq(bodyWithoutCsrf) as never)
    expect(res.status).toBe(400)
  })

  it('rejects tampered csrf_token with 400', async () => {
    const res = await makeConsentHandler()(makeReq({ ...VALID_BODY, csrf_token: 'deadbeef'.repeat(8) }) as never)
    expect(res.status).toBe(400)
  })

  it('rejects forged csrf_token computed for different parameters with 400', async () => {
    const forgery = makeCsrfToken('attacker', 'client-1', REGISTERED_URI, CODE_CHALLENGE)
    const res = await makeConsentHandler()(makeReq({ ...VALID_BODY, csrf_token: forgery }) as never)
    expect(res.status).toBe(400)
  })
})
