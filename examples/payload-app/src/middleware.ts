// The OAuth plugin ships the host-level routing it needs (bare-host MCP rewrite
// + .well-known discovery rewrites) as a ready-made Next.js middleware. Re-export
// the handler — but declare `config` as a LOCAL static literal here.
//
// Next.js parses the middleware `config.matcher` at compile time and (as of
// Next 16) throws "can't recognize the exported `config` field … it mustn't be
// reexported" if `config` is re-exported from another module — which 500s every
// route. So the matcher must live in this file.
//
// If you need your own middleware logic too, import `createMcpOAuthMiddleware`
// instead and call it from within your own handler.
export { mcpOAuthMiddleware as middleware } from '@brainwebuk/payload-plugin-mcp-oauth/middleware'

export const config = {
  matcher: [
    '/',
    '/.well-known/oauth-authorization-server',
    '/.well-known/oauth-protected-resource',
  ],
}
