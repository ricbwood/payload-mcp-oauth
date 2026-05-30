import { describe, expect, it, vi } from 'vitest'
import { installOverrideAuth, wrapMcpEndpointHandler } from '../../../src/middleware/wrap-mcp.js'
import { OAuthInvalidTokenError } from '../../../src/types.js'
import { UnauthorizedError } from 'payload'

process.env['PMOAUTH_TOKEN_PEPPER'] = 'test-pepper-32-chars-minimum-length!!'

const TEST_ISSUER = 'https://example.com'
const TEST_PRM_URL = `${TEST_ISSUER}/.well-known/oauth-protected-resource`

describe('wrapMcpEndpointHandler', () => {
  it('calls the original handler and returns its response', async () => {
    const original = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }))
    const wrapped = wrapMcpEndpointHandler(original, TEST_ISSUER)
    const res = await wrapped({} as never)
    expect(original).toHaveBeenCalledOnce()
    expect(res.status).toBe(200)
  })

  it('converts OAuthInvalidTokenError to 401 with WWW-Authenticate header including resource_metadata', async () => {
    const original = vi.fn().mockRejectedValue(new OAuthInvalidTokenError())
    const wrapped = wrapMcpEndpointHandler(original, TEST_ISSUER)
    const res = await wrapped({} as never)
    expect(res.status).toBe(401)
    const www = res.headers.get('WWW-Authenticate') ?? ''
    expect(www).toContain('Bearer error="invalid_token"')
    expect(www).toContain(`resource_metadata="${TEST_PRM_URL}"`)
  })

  it('adds resource_metadata to 401 responses from the underlying handler', async () => {
    const original = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 401,
        headers: { 'WWW-Authenticate': 'Bearer realm="test"' },
      }),
    )
    const wrapped = wrapMcpEndpointHandler(original, TEST_ISSUER)
    const res = await wrapped({} as never)
    expect(res.status).toBe(401)
    const www = res.headers.get('WWW-Authenticate') ?? ''
    expect(www).toContain('Bearer realm="test"')
    expect(www).toContain(`resource_metadata="${TEST_PRM_URL}"`)
  })

  it('adds resource_metadata to bare 401 with no WWW-Authenticate', async () => {
    const original = vi.fn().mockResolvedValue(new Response(null, { status: 401 }))
    const wrapped = wrapMcpEndpointHandler(original, TEST_ISSUER)
    const res = await wrapped({} as never)
    expect(res.status).toBe(401)
    expect(res.headers.get('WWW-Authenticate')).toContain(`resource_metadata="${TEST_PRM_URL}"`)
  })

  it('does not duplicate resource_metadata if already present', async () => {
    const existing = `Bearer resource_metadata="${TEST_PRM_URL}"`
    const original = vi.fn().mockResolvedValue(
      new Response(null, { status: 401, headers: { 'WWW-Authenticate': existing } }),
    )
    const wrapped = wrapMcpEndpointHandler(original, TEST_ISSUER)
    const res = await wrapped({} as never)
    const www = res.headers.get('WWW-Authenticate') ?? ''
    expect(www.split('resource_metadata=').length - 1).toBe(1)
  })

  it('converts Payload UnauthorizedError to 401 with resource_metadata challenge (no error code)', async () => {
    const original = vi.fn().mockRejectedValue(new UnauthorizedError())
    const wrapped = wrapMcpEndpointHandler(original, TEST_ISSUER)
    const res = await wrapped({} as never)
    expect(res.status).toBe(401)
    const www = res.headers.get('WWW-Authenticate') ?? ''
    expect(www).toContain(`resource_metadata="${TEST_PRM_URL}"`)
    expect(www).not.toContain('error=')
  })

  it('rethrows non-OAuth errors', async () => {
    const original = vi.fn().mockRejectedValue(new Error('DB connection failed'))
    const wrapped = wrapMcpEndpointHandler(original, TEST_ISSUER)
    await expect(wrapped({} as never)).rejects.toThrow('DB connection failed')
  })
})

describe('installOverrideAuth', () => {
  function makePayload(user: unknown = { id: 'user-1', email: 'a@b.com' }) {
    return {
      find: vi.fn().mockResolvedValue({ docs: [] }),
      findByID: vi.fn().mockResolvedValue(user),
    }
  }

  it('sets overrideAuth on mcpPluginOptions', () => {
    const opts = {} as Parameters<typeof installOverrideAuth>[0]
    installOverrideAuth(opts, 'users')
    expect(typeof opts.overrideAuth).toBe('function')
  })

  it('delegates to getDefaultMcpAccessSettings for non-pmoauth tokens', async () => {
    const opts = {} as Parameters<typeof installOverrideAuth>[0]
    installOverrideAuth(opts, 'users')
    const getDefault = vi.fn().mockResolvedValue({ user: { id: 'u1' } })
    const req = {
      headers: { get: vi.fn().mockReturnValue('Bearer api-key-abc123') },
      payload: makePayload(),
    }
    await opts.overrideAuth!(req as never, getDefault)
    expect(getDefault).toHaveBeenCalledOnce()
  })

  it('delegates to getDefaultMcpAccessSettings when no Authorization header', async () => {
    const opts = {} as Parameters<typeof installOverrideAuth>[0]
    installOverrideAuth(opts, 'users')
    const getDefault = vi.fn().mockResolvedValue({ user: { id: 'u1' } })
    const req = {
      headers: { get: vi.fn().mockReturnValue(null) },
      payload: makePayload(),
    }
    await opts.overrideAuth!(req as never, getDefault)
    expect(getDefault).toHaveBeenCalledOnce()
  })

  it('throws OAuthInvalidTokenError for an unknown pmoauth_ token', async () => {
    const opts = {} as Parameters<typeof installOverrideAuth>[0]
    installOverrideAuth(opts, 'users')
    // find returns no docs → validateAccessToken returns null
    const payload = {
      find: vi.fn().mockResolvedValue({ docs: [] }),
      findByID: vi.fn(),
    }
    const req = {
      headers: { get: vi.fn().mockReturnValue('Bearer pmoauth_at_unknowntoken12345678901234567890123') },
      payload,
    }
    const getDefault = vi.fn()
    await expect(opts.overrideAuth!(req as never, getDefault)).rejects.toThrow(OAuthInvalidTokenError)
    expect(getDefault).not.toHaveBeenCalled()
  })
})
