// The OAuth plugin ships the host-level routing it needs (bare-host MCP rewrite
// + .well-known discovery rewrites) as a ready-made Next.js middleware. For the
// default Payload layout, re-exporting it is all that's required.
//
// If you need your own middleware logic too, import `createMcpOAuthMiddleware`
// instead and call it from within your own handler.
export { mcpOAuthMiddleware as middleware, config } from '@brainwebuk/payload-plugin-mcp-oauth/middleware'
