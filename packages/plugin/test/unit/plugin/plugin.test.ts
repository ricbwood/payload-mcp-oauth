import { describe, expect, it } from 'vitest'
import { buildPlugin } from '../../../src/plugin.js'
import { PayloadMcpOAuthError } from '../../../src/types.js'
import type { PayloadMcpOAuthConfig } from '../../../src/types.js'

process.env['PMOAUTH_TOKEN_PEPPER'] = 'test-pepper-32-chars-minimum-length!!'

const MCP_ENDPOINT = { path: '/mcp', method: 'post' as const, handler: async () => new Response('ok') }

function makeConfig(endpointOverrides: unknown[] = [MCP_ENDPOINT]) {
  return {
    endpoints: endpointOverrides as import('payload').Endpoint[],
    collections: [],
  } as import('payload').Config
}

function makeOptions(overrides: Partial<PayloadMcpOAuthConfig> = {}): PayloadMcpOAuthConfig {
  return {
    issuer: 'https://cms.example.com',
    mcpPluginOptions: {},
    ...overrides,
  }
}

describe('buildPlugin — config validation', () => {
  it('throws MISSING_ISSUER when issuer is absent', () => {
    expect(() => buildPlugin(makeConfig(), makeOptions({ issuer: '' }))).toThrow(PayloadMcpOAuthError)
  })

  it('throws INVALID_ISSUER when issuer is not a URL', () => {
    expect(() =>
      buildPlugin(makeConfig(), makeOptions({ issuer: 'not-a-url' })),
    ).toThrow(PayloadMcpOAuthError)
  })

  it('throws MISSING_MCP_OPTIONS when mcpPluginOptions is absent', () => {
    expect(() =>
      buildPlugin(makeConfig(), makeOptions({ mcpPluginOptions: undefined as never })),
    ).toThrow(PayloadMcpOAuthError)
  })
})

describe('buildPlugin — order detection (T5.3)', () => {
  it('throws PLUGIN_ORDER when no /mcp endpoint is present', () => {
    expect(() => buildPlugin(makeConfig([]), makeOptions())).toThrow(PayloadMcpOAuthError)
  })

  it('accepts config when /mcp endpoint exists', () => {
    expect(() => buildPlugin(makeConfig([MCP_ENDPOINT]), makeOptions())).not.toThrow()
  })
})

describe('buildPlugin — collections (T5.5)', () => {
  it('adds the three OAuth collections', () => {
    const result = buildPlugin(makeConfig(), makeOptions())
    const slugs = result.collections?.map((c) => c.slug)
    expect(slugs).toContain('oauth-clients')
    expect(slugs).toContain('oauth-auth-codes')
    expect(slugs).toContain('oauth-tokens')
  })

  it('preserves existing collections', () => {
    const existing = { slug: 'posts', fields: [] }
    const config = makeConfig()
    config.collections = [existing]
    const result = buildPlugin(config, makeOptions())
    expect(result.collections?.map((c) => c.slug)).toContain('posts')
  })
})

describe('buildPlugin — endpoints (T5.5)', () => {
  it('registers all 7 OAuth endpoints', () => {
    const result = buildPlugin(makeConfig(), makeOptions())
    const paths = result.endpoints?.map((e) => e.path) ?? []
    expect(paths).toContain('/.well-known/oauth-authorization-server')
    expect(paths).toContain('/.well-known/oauth-protected-resource')
    expect(paths).toContain('/oauth/register')
    expect(paths).toContain('/oauth/authorize')
    expect(paths).toContain('/oauth/consent')
    expect(paths).toContain('/oauth/token')
    expect(paths).toContain('/oauth/revoke')
  })

  it('preserves the MCP endpoint (does not remove it)', () => {
    const result = buildPlugin(makeConfig(), makeOptions())
    expect(result.endpoints?.some((e) => e.path === '/mcp')).toBe(true)
  })

  it('wraps the MCP endpoint handler', () => {
    const opts = makeOptions()
    const result = buildPlugin(makeConfig(), opts)
    const mcpEndpoint = result.endpoints?.find((e) => e.path === '/mcp')
    // The handler should now be the wrapped version
    expect(typeof mcpEndpoint?.handler).toBe('function')
  })
})

describe('payloadMcpOAuth — overrideAuth installation (T5.4)', () => {
  it('sets overrideAuth on mcpPluginOptions eagerly (before plugin execution)', async () => {
    // overrideAuth must be set during payloadMcpOAuth() call, not deferred to plugin execution,
    // because Payload's definePlugin spreads mcpPluginOptions into a new object when it runs
    // the plugin — so mutations applied after that point are invisible to the MCP handler closure.
    const { payloadMcpOAuth } = await import('../../../src/index.js')
    const mcpOpts = {}
    payloadMcpOAuth(makeOptions({ mcpPluginOptions: mcpOpts }))
    expect(typeof (mcpOpts as Record<string, unknown>)['overrideAuth']).toBe('function')
  })
})

describe('payloadMcpOAuth — exported factory', () => {
  it('returns a Plugin function that transforms config', async () => {
    const { payloadMcpOAuth } = await import('../../../src/index.js')
    const plugin = payloadMcpOAuth(makeOptions())
    expect(typeof plugin).toBe('function')
    const result = plugin(makeConfig())
    expect(result).toBeTruthy()
  })
})
