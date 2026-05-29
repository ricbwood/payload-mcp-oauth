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

    const ctx = await validateAccessToken(req.payload, bearer)
    if (!ctx) {
      throw new OAuthInvalidTokenError()
    }

    const user = await req.payload.findByID({
      collection: userCollection,
      id: ctx.userId,
    })

    return {
      user: user as TypedUser,
      ...ctx.capabilities,
    } as MCPAccessSettings
  }
}

/**
 * Wraps a PayloadHandler so that OAuthInvalidTokenError thrown by overrideAuth
 * is caught and converted to a spec-compliant 401 response instead of a 500.
 */
export function wrapMcpEndpointHandler(
  original: (req: PayloadRequest) => Promise<Response> | Response,
): (req: PayloadRequest) => Promise<Response> {
  return async (req) => {
    try {
      return await original(req)
    } catch (err) {
      if (err instanceof OAuthInvalidTokenError) {
        return new Response(null, {
          status: 401,
          headers: {
            'WWW-Authenticate': 'Bearer error="invalid_token", error_description="OAuth token is invalid or expired"',
            'Cache-Control': 'no-store',
          },
        })
      }
      throw err
    }
  }
}
