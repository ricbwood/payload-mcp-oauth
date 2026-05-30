import type { Plugin } from 'payload'
import type { PayloadMcpOAuthConfig } from './types.js'
import { buildPlugin } from './plugin.js'
import { installOverrideAuth } from './middleware/wrap-mcp.js'

export type { PayloadMcpOAuthConfig, ResolvedConfig } from './types.js'
export { PayloadMcpOAuthError, OAuthInvalidTokenError } from './types.js'
export type { AsMetadata } from './endpoints/metadata-as.js'
export type { PrmMetadata } from './endpoints/metadata-prm.js'
export type { RateLimitConfig, RateLimitOptions, RateLimiter } from './middleware/rate-limit.js'

/**
 * Payload plugin that adds OAuth 2.1 + PKCE + Dynamic Client Registration
 * to an existing `@payloadcms/plugin-mcp` MCP server.
 *
 * Must be registered AFTER `mcpPlugin()` in the plugins array:
 *
 * ```ts
 * const mcpOptions: MCPPluginConfig = { ... }
 *
 * export default buildConfig({
 *   plugins: [
 *     mcpPlugin(mcpOptions),
 *     payloadMcpOAuth({ issuer: 'https://cms.example.com', mcpPluginOptions: mcpOptions }),
 *   ],
 * })
 * ```
 */
export function payloadMcpOAuth(options: PayloadMcpOAuthConfig): Plugin {
  // Install overrideAuth EAGERLY (before Payload runs any plugin).
  // Payload's definePlugin spreads mcpPluginOptions into a new object when it runs the plugin
  // function, so mutations applied AFTER mcpPlugin runs are invisible to its closure.
  // By setting overrideAuth here (during the payloadMcpOAuth() call, which happens at config
  // build time before any plugin executes), it is present in mcpOptions when mcpPlugin's
  // definePlugin spreads it, and therefore captured correctly in initializeMCPHandler's closure.
  if (options.mcpPluginOptions) {
    installOverrideAuth(options.mcpPluginOptions, options.userCollection ?? 'users')
  }

  const fn: Plugin = (incomingConfig) => buildPlugin(incomingConfig, options)
  // mcpPlugin uses definePlugin with order:10; we must run after it
  fn.order = 20
  return fn
}
