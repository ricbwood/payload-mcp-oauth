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
})
