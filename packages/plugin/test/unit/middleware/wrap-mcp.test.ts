import { describe, expect, it, vi } from 'vitest'
import { installOverrideAuth, wrapMcpEndpointHandler } from '../../../src/middleware/wrap-mcp.js'
import { OAuthInvalidTokenError } from '../../../src/types.js'

process.env['PMOAUTH_TOKEN_PEPPER'] = 'test-pepper-32-chars-minimum-length!!'

describe('wrapMcpEndpointHandler', () => {
  it('calls the original handler and returns its response', async () => {
    const original = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }))
    const wrapped = wrapMcpEndpointHandler(original)
    const res = await wrapped({} as never)
    expect(original).toHaveBeenCalledOnce()
    expect(res.status).toBe(200)
  })

  it('converts OAuthInvalidTokenError to 401 with WWW-Authenticate header', async () => {
    const original = vi.fn().mockRejectedValue(new OAuthInvalidTokenError())
    const wrapped = wrapMcpEndpointHandler(original)
    const res = await wrapped({} as never)
    expect(res.status).toBe(401)
    expect(res.headers.get('WWW-Authenticate')).toContain('Bearer error="invalid_token"')
  })

  it('rethrows non-OAuth errors', async () => {
    const original = vi.fn().mockRejectedValue(new Error('DB connection failed'))
    const wrapped = wrapMcpEndpointHandler(original)
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
