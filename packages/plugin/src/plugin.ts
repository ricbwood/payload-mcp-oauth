import type { Config, Endpoint, PayloadRequest } from 'payload'
import type { PayloadMcpOAuthConfig, ResolvedConfig } from './types.js'
import { oauthAuthCodesCollection } from './collections/auth-codes.js'
import { oauthClientsCollection } from './collections/clients.js'
import { oauthTokensCollection } from './collections/tokens.js'
import { makeAuthorizeHandler } from './endpoints/authorize.js'
import { makeConsentHandler } from './endpoints/consent.js'
import { makeAsMetadataHandler } from './endpoints/metadata-as.js'
import { makePrmMetadataHandler } from './endpoints/metadata-prm.js'
import { makeRegisterHandler } from './endpoints/register.js'
import { makeRevokeHandler } from './endpoints/revoke.js'
import { makeTokenHandler } from './endpoints/token.js'
import { createRateLimitStore, rateLimitKey } from './middleware/rate-limit.js'
import { installOverrideAuth, wrapMcpEndpointHandler } from './middleware/wrap-mcp.js'
import { PayloadMcpOAuthError } from './types.js'

const SUPPORTED_MCP_RANGE = { min: [3, 0, 0], max: [3, 999, 999] } as const

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
}

function withCors(handler: (req: PayloadRequest) => Promise<Response> | Response) {
  return async (req: PayloadRequest): Promise<Response> => {
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS })
    }
    const res = await handler(req as never)
    const headers = new Headers(res.headers)
    headers.set('Access-Control-Allow-Origin', '*')
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
  }
}

function resolveConfig(options: PayloadMcpOAuthConfig): ResolvedConfig {
  const { issuer, mcpPluginOptions } = options

  if (!issuer || typeof issuer !== 'string') {
    throw new PayloadMcpOAuthError('MISSING_ISSUER', 'payloadMcpOAuth: issuer is required')
  }
  try {
    new URL(issuer)
  } catch {
    throw new PayloadMcpOAuthError('INVALID_ISSUER', `payloadMcpOAuth: issuer must be a valid URL, got "${issuer}"`)
  }

  if (!mcpPluginOptions || typeof mcpPluginOptions !== 'object') {
    throw new PayloadMcpOAuthError(
      'MISSING_MCP_OPTIONS',
      'payloadMcpOAuth: mcpPluginOptions is required — pass the same options object you give to mcpPlugin()',
    )
  }

  const pepper = process.env['PMOAUTH_TOKEN_PEPPER']
  if (!pepper || pepper.length < 32) {
    if (process.env['NODE_ENV'] === 'production') {
      throw new PayloadMcpOAuthError(
        'MISSING_PEPPER',
        'PMOAUTH_TOKEN_PEPPER must be set to a string of at least 32 characters in production',
      )
    }
  }

  return {
    issuer: issuer.replace(/\/$/, ''),
    mcpPluginOptions,
    userCollection: options.userCollection ?? 'users',
    accessTokenTtlSeconds: options.accessTokenTtlSeconds ?? 3600,
    refreshTokenTtlSeconds: options.refreshTokenTtlSeconds ?? 86400,
    authCodeTtlSeconds: options.authCodeTtlSeconds ?? 300,
    rateLimits: options.rateLimits ?? {},
  }
}

function detectMcpEndpoints(config: Config): Endpoint[] {
  const endpoints = config.endpoints ?? []
  const mcp = endpoints.filter((e) => e.path === '/mcp' || e.path === '/api/mcp')
  if (mcp.length === 0) {
    throw new PayloadMcpOAuthError(
      'PLUGIN_ORDER',
      'payloadMcpOAuth must be registered AFTER mcpPlugin() in the plugins array. ' +
        'No /mcp endpoint found in incomingConfig — ensure mcpPlugin() runs first.',
    )
  }
  return mcp
}

function warnIfVersionUntested(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkg = require('@payloadcms/plugin-mcp/package.json') as { version?: string }
    const raw = pkg.version ?? ''
    const parts = raw.split('.').map(Number)
    const [major = 0, minor = 0, patch = 0] = parts
    const [minMaj, minMin, minPatch] = SUPPORTED_MCP_RANGE.min
    const [maxMaj, maxMin, maxPatch] = SUPPORTED_MCP_RANGE.max
    const tooOld =
      major < minMaj ||
      (major === minMaj && minor < minMin) ||
      (major === minMaj && minor === minMin && patch < minPatch)
    const tooNew =
      major > maxMaj ||
      (major === maxMaj && minor > maxMin) ||
      (major === maxMaj && minor === maxMin && patch > maxPatch)
    if (tooOld || tooNew) {
      console.warn(
        `[payloadMcpOAuth] @payloadcms/plugin-mcp@${raw} is outside the tested range ` +
          `(${SUPPORTED_MCP_RANGE.min.join('.')}–${SUPPORTED_MCP_RANGE.max.join('.')}). ` +
          `Proceed with caution.`,
      )
    }
  } catch {
    // Package resolution failed — non-fatal
  }
}

export function buildPlugin(incomingConfig: Config, options: PayloadMcpOAuthConfig): Config {
  const resolved = resolveConfig(options)
  const mcpEndpoints = detectMcpEndpoints(incomingConfig)
  warnIfVersionUntested()

  // T5.4: install overrideAuth on the shared MCP options reference
  installOverrideAuth(resolved.mcpPluginOptions, resolved.userCollection)

  // T5.4: wrap MCP endpoint handlers to convert OAuthInvalidTokenError → 401
  for (const endpoint of mcpEndpoints) {
    if (typeof endpoint.handler === 'function') {
      endpoint.handler = wrapMcpEndpointHandler(endpoint.handler)
    }
  }

  // T5.5: build rate limiters
  const rateLimits = createRateLimitStore(resolved.rateLimits)

  // Helper to apply rate limiting inside a handler
  function withRateLimit(
    limiter: ReturnType<typeof createRateLimitStore>[keyof ReturnType<typeof createRateLimitStore>],
    clientIdField: string | null,
    handler: (req: PayloadRequest) => Promise<Response> | Response,
  ) {
    return async (req: PayloadRequest): Promise<Response> => {
      const ip = (req.headers.get?.('x-forwarded-for') ?? '').split(',')[0]?.trim()
      const body = req.method === 'POST' ? (req.data as Record<string, unknown> | undefined) : undefined
      const clientId = clientIdField && body ? (body[clientIdField] as string | undefined) : undefined
      const key = rateLimitKey(ip, clientId)
      const allowed = limiter.check(key)
      if (!allowed) {
        return Response.json(
          { error: 'too_many_requests', error_description: 'Rate limit exceeded' },
          { status: 429, headers: { 'Cache-Control': 'no-store', 'Retry-After': '60' } },
        )
      }
      return handler(req as never)
    }
  }

  const corsPreflightHandler = () => new Response(null, { status: 204, headers: CORS_HEADERS })

  // T5.5: build OAuth endpoints
  const oauthEndpoints: Endpoint[] = [
    {
      path: '/.well-known/oauth-authorization-server',
      method: 'get',
      handler: makeAsMetadataHandler(resolved.issuer),
    },
    {
      path: '/.well-known/oauth-protected-resource',
      method: 'get',
      handler: makePrmMetadataHandler(resolved.issuer),
    },
    {
      path: '/oauth/register',
      method: 'post',
      handler: withCors(withRateLimit(rateLimits.register, 'client_name', makeRegisterHandler())),
    },
    { path: '/oauth/register', method: 'options', handler: corsPreflightHandler },
    {
      path: '/oauth/authorize',
      method: 'get',
      handler: withRateLimit(rateLimits.authorize, null, makeAuthorizeHandler()),
    },
    {
      path: '/oauth/consent',
      method: 'post',
      handler: makeConsentHandler(resolved.authCodeTtlSeconds, resolved.issuer),
    },
    {
      path: '/oauth/token',
      method: 'post',
      handler: withCors(withRateLimit(rateLimits.token, 'client_id', makeTokenHandler())),
    },
    { path: '/oauth/token', method: 'options', handler: corsPreflightHandler },
    {
      path: '/oauth/revoke',
      method: 'post',
      handler: withCors(withRateLimit(rateLimits.revoke, 'client_id', makeRevokeHandler())),
    },
    { path: '/oauth/revoke', method: 'options', handler: corsPreflightHandler },
  ]

  // T6.2 / T6.3: register admin views
  const adminViews = {
    ...(incomingConfig.admin?.components?.views ?? {}),
    'oauth-tokens': {
      Component: {
        path: '@brainweb/payload-plugin-mcp-oauth/admin',
        exportName: 'TokensView',
      },
      path: '/oauth/tokens' as `/${string}`,
    },
    'oauth-clients': {
      Component: {
        path: '@brainweb/payload-plugin-mcp-oauth/admin',
        exportName: 'ClientsView',
      },
      path: '/oauth/clients' as `/${string}`,
    },
  }

  // T5.5 / T6: merge collections, endpoints, and admin views
  return {
    ...incomingConfig,
    collections: [
      ...(incomingConfig.collections ?? []),
      oauthClientsCollection,
      oauthAuthCodesCollection,
      oauthTokensCollection,
    ],
    endpoints: [...(incomingConfig.endpoints ?? []), ...oauthEndpoints],
    admin: {
      ...incomingConfig.admin,
      components: {
        ...incomingConfig.admin?.components,
        views: adminViews,
      },
    },
  }
}
