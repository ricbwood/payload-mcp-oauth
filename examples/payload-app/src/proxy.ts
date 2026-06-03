// Next.js 16 renamed the `middleware` file convention to `proxy` (a
// `middleware.ts` still works but logs a deprecation warning). This app is on
// Next 16, so the host-level routing the OAuth plugin needs (bare-host MCP
// rewrite + .well-known discovery rewrites) is wired up as a `proxy`.
//
// On Next 14/15 the `proxy` convention doesn't exist — name the file
// `middleware.ts` and export the handler as `middleware` instead; the body is
// identical.
//
// `config` MUST be a local static literal here. Next parses the matcher at
// compile time and (as of Next 16) throws "can't recognize the exported
// `config` field … it mustn't be reexported" if it's re-exported from another
// module — which 500s every route.
//
// If you need your own proxy logic too, import `createMcpOAuthMiddleware`
// instead and call it from within your own handler.
export { mcpOAuthMiddleware as proxy } from '@brainwebuk/payload-plugin-mcp-oauth/middleware'

export const config = {
  matcher: [
    '/',
    '/.well-known/oauth-authorization-server',
    '/.well-known/oauth-protected-resource',
  ],
}
