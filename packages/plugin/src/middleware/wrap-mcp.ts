import type { MCPAccessSettings, MCPPluginConfig } from '@payloadcms/plugin-mcp'
import type { PayloadRequest, TypedUser } from 'payload'
import { validateAccessToken } from '../lib/validate.js'
import { OAuthInvalidTokenError } from '../types.js'

/**
 * Installs an `overrideAuth` function on the shared MCP plugin options reference.
 * When the Bearer token starts with `pmoauth_`, the OAuth validation path runs;
 * otherwise, the original API-key path is preserved.
 *
 * The handler wrapper (wrapMcpEndpointHandler) must be applied to the MCP endpoint
 * so that OAuthInvalidTokenError thrown here is converted to a 401 Response.
 */
export function installOverrideAuth(mcpPluginOptions: MCPPluginConfig, userCollection: string): void {
  mcpPluginOptions.overrideAuth = async (req, getDefaultMcpAccessSettings) => {
    const bearer = req.headers.get?.('Authorization')?.replace(/^Bearer\s+/i, '')

    if (!bearer?.startsWith('pmoauth_')) {
      return getDefaultMcpAccessSettings()
    }

    req.payload.logger?.info(`[pmoauth] overrideAuth: validating token prefix=${bearer.slice(0, 18)}`)

    const ctx = await validateAccessToken(req.payload, bearer)
    if (!ctx) {
      req.payload.logger?.warn('[pmoauth] overrideAuth: validateAccessToken returned null — token not found/expired/revoked')
      throw new OAuthInvalidTokenError()
    }

    req.payload.logger?.info(`[pmoauth] overrideAuth: token valid, userId=${ctx.userId}, fetching user`)

    let user
    try {
      user = await req.payload.findByID({
        collection: userCollection,
        overrideAccess: true,
        id: ctx.userId,
      })
    } catch (err) {
      req.payload.logger?.error(`[pmoauth] overrideAuth: findByID failed for userId=${ctx.userId}: ${String(err)}`)
      throw new OAuthInvalidTokenError()
    }

    if (!user) {
      req.payload.logger?.warn(`[pmoauth] overrideAuth: user not found for userId=${ctx.userId}`)
      throw new OAuthInvalidTokenError()
    }

    req.payload.logger?.info(`[pmoauth] overrideAuth: success, returning MCPAccessSettings`)

    return {
      user: user as TypedUser,
      ...ctx.capabilities,
    } as MCPAccessSettings
  }
}

/**
 * Wraps a PayloadHandler so that:
 * - OAuthInvalidTokenError thrown by overrideAuth is converted to a spec-compliant 401
 * - Any 401 from the underlying MCP handler gets resource_metadata appended to
 *   WWW-Authenticate per RFC 9728, enabling client AS discovery
 */
export function wrapMcpEndpointHandler(
  original: (req: PayloadRequest) => Promise<Response> | Response,
  issuer: string,
): (req: PayloadRequest) => Promise<Response> {
  const prmUrl = `${issuer.replace(/\/$/, '')}/.well-known/oauth-protected-resource`

  function addResourceMetadata(wwwAuth: string | null): string {
    const resourceMeta = `resource_metadata="${prmUrl}"`
    if (!wwwAuth) return `Bearer ${resourceMeta}`
    if (wwwAuth.includes('resource_metadata=')) return wwwAuth
    return `${wwwAuth}, ${resourceMeta}`
  }

  return async (req) => {
    try {
      const res = await original(req)
      if (res.status === 401) {
        const headers = new Headers(res.headers)
        headers.set('WWW-Authenticate', addResourceMetadata(res.headers.get('WWW-Authenticate')))
        return new Response(res.body, { status: 401, statusText: res.statusText, headers })
      }
      return res
    } catch (err) {
      if (err instanceof OAuthInvalidTokenError) {
        return new Response(null, {
          status: 401,
          headers: {
            'WWW-Authenticate': `Bearer error="invalid_token", error_description="OAuth token is invalid or expired", resource_metadata="${prmUrl}"`,
            'Cache-Control': 'no-store',
          },
        })
      }
      throw err
    }
  }
}
