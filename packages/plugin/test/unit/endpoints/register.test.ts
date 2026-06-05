import { describe, expect, it, vi } from 'vitest'
import { makeRegisterHandler } from '../../../src/endpoints/register.js'

function makeReq(body: unknown, method = 'POST') {
  return {
    method,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn(),
    payload: {
      create: vi.fn().mockResolvedValue({ id: 'client-1' }),
    },
  }
}

describe('makeRegisterHandler', () => {
  it('returns 201 with client_id for a valid request', async () => {
    const req = makeReq({ client_name: 'My App', redirect_uris: ['https://example.com/cb'] })
    const res = await makeRegisterHandler()(req as never)
    expect(res.status).toBe(201)
    const body = await res.json() as Record<string, unknown>
    expect(body['client_id']).toBeTruthy()
    expect(req.payload.create).toHaveBeenCalledOnce()
  })

  it('rejects missing client_name', async () => {
    const res = await makeRegisterHandler()(makeReq({ redirect_uris: ['https://a.com/cb'] }) as never)
    expect(res.status).toBe(400)
    expect(((await res.json()) as Record<string, unknown>)['error']).toBe('invalid_client_metadata')
  })

  it('rejects empty client_name', async () => {
    const res = await makeRegisterHandler()(makeReq({ client_name: '  ', redirect_uris: ['https://a.com/cb'] }) as never)
    expect(res.status).toBe(400)
  })

  it('rejects missing redirect_uris', async () => {
    const res = await makeRegisterHandler()(makeReq({ client_name: 'App' }) as never)
    expect(res.status).toBe(400)
    expect(((await res.json()) as Record<string, unknown>)['error']).toBe('invalid_client_metadata')
  })

  it('rejects non-HTTPS redirect_uri (not localhost)', async () => {
    const res = await makeRegisterHandler()(
      makeReq({ client_name: 'App', redirect_uris: ['http://example.com/cb'] }) as never,
    )
    expect(res.status).toBe(400)
    expect(((await res.json()) as Record<string, unknown>)['error']).toBe('invalid_redirect_uri')
  })

  it('accepts localhost http redirect_uri', async () => {
    const req = makeReq({ client_name: 'App', redirect_uris: ['http://localhost:3000/cb'] })
    expect((await makeRegisterHandler()(req as never)).status).toBe(201)
  })

  it('accepts IPv6 loopback [::1] http redirect_uri', async () => {
    const req = makeReq({ client_name: 'App', redirect_uris: ['http://[::1]:3000/cb'] })
    expect((await makeRegisterHandler()(req as never)).status).toBe(201)
  })

  it('rejects a redirect_uri containing a fragment (RFC 6749 §3.1.2)', async () => {
    const res = await makeRegisterHandler()(
      makeReq({ client_name: 'App', redirect_uris: ['https://a.com/cb#frag'] }) as never,
    )
    expect(res.status).toBe(400)
    expect(((await res.json()) as Record<string, unknown>)['error']).toBe('invalid_redirect_uri')
  })

  it('caps software_id at 100 characters', async () => {
    const res = await makeRegisterHandler()(
      makeReq({ client_name: 'App', redirect_uris: ['https://a.com/cb'], software_id: 'x'.repeat(101) }) as never,
    )
    expect(res.status).toBe(400)
    expect(((await res.json()) as Record<string, unknown>)['error']).toBe('invalid_client_metadata')
  })

  it('caps software_version at 100 characters', async () => {
    const res = await makeRegisterHandler()(
      makeReq({ client_name: 'App', redirect_uris: ['https://a.com/cb'], software_version: 'x'.repeat(101) }) as never,
    )
    expect(res.status).toBe(400)
    expect(((await res.json()) as Record<string, unknown>)['error']).toBe('invalid_client_metadata')
  })

  it('accepts software_id / software_version within the cap', async () => {
    const req = makeReq({
      client_name: 'App',
      redirect_uris: ['https://a.com/cb'],
      software_id: 'my-software',
      software_version: '1.2.3',
    })
    expect((await makeRegisterHandler()(req as never)).status).toBe(201)
    expect(req.payload.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ softwareId: 'my-software', softwareVersion: '1.2.3' }),
      }),
    )
  })

  it('rejects invalid redirect_uri URL', async () => {
    const res = await makeRegisterHandler()(makeReq({ client_name: 'App', redirect_uris: ['not-a-url'] }) as never)
    expect(res.status).toBe(400)
    expect(((await res.json()) as Record<string, unknown>)['error']).toBe('invalid_redirect_uri')
  })

  it('rejects unsupported token_endpoint_auth_method', async () => {
    const res = await makeRegisterHandler()(
      makeReq({ client_name: 'App', redirect_uris: ['https://a.com/cb'], token_endpoint_auth_method: 'client_secret_post' }) as never,
    )
    expect(res.status).toBe(400)
  })

  it('rejects unsupported grant_type', async () => {
    const res = await makeRegisterHandler()(
      makeReq({ client_name: 'App', redirect_uris: ['https://a.com/cb'], grant_types: ['client_credentials'] }) as never,
    )
    expect(res.status).toBe(400)
  })

  it('rejects unsupported response_type', async () => {
    const res = await makeRegisterHandler()(
      makeReq({ client_name: 'App', redirect_uris: ['https://a.com/cb'], response_types: ['token'] }) as never,
    )
    expect(res.status).toBe(400)
  })

  it('returns 405 for non-POST', async () => {
    const res = await makeRegisterHandler()(makeReq({}, 'GET') as never)
    expect(res.status).toBe(405)
  })

  it('rejects client_name longer than 100 characters', async () => {
    const res = await makeRegisterHandler()(
      makeReq({ client_name: 'A'.repeat(101), redirect_uris: ['https://a.com/cb'] }) as never,
    )
    expect(res.status).toBe(400)
    expect(((await res.json()) as Record<string, unknown>)['error']).toBe('invalid_client_metadata')
  })

  it('accepts client_name of exactly 100 characters', async () => {
    const req = makeReq({ client_name: 'A'.repeat(100), redirect_uris: ['https://a.com/cb'] })
    expect((await makeRegisterHandler()(req as never)).status).toBe(201)
  })

  it('rejects more than 10 redirect_uris', async () => {
    const uris = Array.from({ length: 11 }, (_, i) => `https://example${i}.com/cb`)
    const res = await makeRegisterHandler()(
      makeReq({ client_name: 'App', redirect_uris: uris }) as never,
    )
    expect(res.status).toBe(400)
    expect(((await res.json()) as Record<string, unknown>)['error']).toBe('invalid_client_metadata')
  })

  it('accepts exactly 10 redirect_uris', async () => {
    const uris = Array.from({ length: 10 }, (_, i) => `https://example${i}.com/cb`)
    const req = makeReq({ client_name: 'App', redirect_uris: uris })
    expect((await makeRegisterHandler()(req as never)).status).toBe(201)
  })

  it('rejects a redirect_uri exceeding 2048 characters', async () => {
    const longPath = 'https://example.com/' + 'a'.repeat(2048)
    const res = await makeRegisterHandler()(
      makeReq({ client_name: 'App', redirect_uris: [longPath] }) as never,
    )
    expect(res.status).toBe(400)
    expect(((await res.json()) as Record<string, unknown>)['error']).toBe('invalid_redirect_uri')
  })
})
