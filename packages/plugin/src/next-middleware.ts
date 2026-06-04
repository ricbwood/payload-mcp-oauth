import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { OAUTH_DISCOVERY_PATHS } from './lib/paths.js'

// Built once at module load; O(1), type-safe membership (no assertion). Derived
// from OAUTH_DISCOVERY_PATHS, so new discovery paths are picked up automatically.
const DISCOVERY_PATHS = new Set<string>(OAUTH_DISCOVERY_PATHS)

/**
 * Options for {@link createMcpOAuthMiddleware}.
 *
 * All fields are optional and default to the conventions used by
 * `@payloadcms/plugin-mcp` + this plugin. Override them only if your app
 * uses a non-default Payload API route or MCP endpoint path.
 */
export interface McpOAuthMiddlewareOptions {
  /**
   * Payload's API route prefix, matching `config.routes.api`.
   * @default '/api'
   */
  apiRoute?: string

  /**
   * The MCP streamable-HTTP endpoint path, relative to the host.
   * @default '/api/mcp'
   */
  mcpEndpointPath?: string

  /**
   * Rewrite bare-host `POST /` requests that look like MCP clients to the MCP
   * endpoint. Lets Claude.ai connectors registered with the bare host URL work
   * without an explicit `/api/mcp` suffix.
   * @default true
   */
  rewriteBareHostMcp?: boolean

  /**
   * Rewrite the two OAuth discovery documents from the root (where clients
   * fetch them per RFC 8414 / RFC 9728) to Payload's `/api`-mounted endpoints.
   * @default true
   */
  rewriteWellKnown?: boolean
}

/** MCP streamable-HTTP clients send JSON bodies AND accept SSE responses. */
function looksLikeMcpClient(request: NextRequest): boolean {
  const accept = request.headers.get('accept') ?? ''
  const contentType = request.headers.get('content-type') ?? ''
  // Requiring both avoids rewriting unrelated JSON POSTs (webhooks, REST calls).
  return contentType.includes('application/json') && accept.includes('text/event-stream')
}

/**
 * Builds a Next.js middleware that wires the host-level routing the OAuth plugin
 * needs but cannot register from inside Payload:
 *
 *  1. `POST /` (MCP-looking) → `<mcpEndpointPath>` so bare-host connectors work.
 *  2. `/.well-known/oauth-authorization-server` → `<apiRoute>/.well-known/...`
 *  3. `/.well-known/oauth-protected-resource`   → `<apiRoute>/.well-known/...`
 *
 * Pair this with the exported {@link config} (a static matcher Next.js can
 * analyse). For the common case, re-export the ready-made {@link mcpOAuthMiddleware}.
 */
export function createMcpOAuthMiddleware(
  options: McpOAuthMiddlewareOptions = {},
): (request: NextRequest) => NextResponse {
  const apiRoute = (options.apiRoute ?? '/api').replace(/\/$/, '')
  const mcpEndpointPath = options.mcpEndpointPath ?? `${apiRoute}/mcp`
  const rewriteBareHostMcp = options.rewriteBareHostMcp ?? true
  const rewriteWellKnown = options.rewriteWellKnown ?? true

  return function mcpOAuthMiddleware(request: NextRequest): NextResponse {
    const { method, nextUrl } = request
    const { pathname } = nextUrl

    if (rewriteWellKnown && DISCOVERY_PATHS.has(pathname)) {
      const rewritten = nextUrl.clone()
      rewritten.pathname = `${apiRoute}${pathname}`
      return NextResponse.rewrite(rewritten)
    }

    if (rewriteBareHostMcp && pathname === '/' && method === 'POST' && looksLikeMcpClient(request)) {
      const rewritten = nextUrl.clone()
      rewritten.pathname = mcpEndpointPath
      return NextResponse.rewrite(rewritten)
    }

    return NextResponse.next()
  }
}

/**
 * Ready-to-use middleware for the default Payload layout. Re-export it from your
 * project's `middleware.ts` together with {@link config}:
 *
 * ```ts
 * export { mcpOAuthMiddleware as middleware, config } from '@brainwebuk/payload-plugin-mcp-oauth/middleware'
 * ```
 *
 * If you already have a `middleware.ts`, call {@link createMcpOAuthMiddleware}
 * inside it instead and merge the result with your own logic.
 */
export const mcpOAuthMiddleware = createMcpOAuthMiddleware()

/**
 * Static matcher for the paths the middleware acts on. Next.js requires
 * `config.matcher` to be statically analysable, so this MUST stay a string
 * literal (it can't reference OAUTH_DISCOVERY_PATHS). A unit test asserts it
 * stays in sync with those constants.
 */
export const config = {
  matcher: [
    '/',
    '/.well-known/oauth-authorization-server',
    '/.well-known/oauth-protected-resource',
  ],
}
