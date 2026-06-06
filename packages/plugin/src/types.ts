import type { Access } from 'payload'
import type { MCPPluginConfig } from '@payloadcms/plugin-mcp'
import type { RateLimitOptions } from './middleware/rate-limit.js'

export interface PayloadMcpOAuthConfig {
  /**
   * The public base URL of the Payload instance (e.g. https://cms.example.com).
   * Used as the OAuth `issuer` and to construct all endpoint URLs in metadata.
   */
  issuer: string

  /**
   * A reference to the SAME options object passed to `mcpPlugin()`.
   * The OAuth plugin sets `overrideAuth` on this reference so that the MCP
   * handler can validate OAuth tokens at request time.
   *
   * ⚠️ This must be the exact same object reference — not a copy, spread, or
   * fresh literal. Assign it to a `const` and pass that same `const` to both
   * `mcpPlugin()` and `payloadMcpOAuth()`:
   *
   * ```ts
   * const mcpOptions: MCPPluginConfig = { collections: { ... } }
   * plugins: [
   *   mcpPlugin(mcpOptions),
   *   payloadMcpOAuth({ issuer, mcpPluginOptions: mcpOptions }),
   * ]
   * ```
   *
   * If you pass a different object, `overrideAuth` is installed on an object the
   * MCP handler never sees, and OAuth tokens silently fail to authenticate while
   * the API-key path keeps working.
   */
  mcpPluginOptions: MCPPluginConfig

  /**
   * Turn the OAuth layer off without uninstalling. When `true` (or when the MCP
   * plugin itself is disabled via `mcpPluginOptions.disabled`), the plugin adds
   * NO endpoints, does NO token-validation wiring, and leaves `mcpPluginOptions`
   * untouched — the MCP server keeps working with API keys only.
   *
   * The OAuth collections are still registered (they're relationally isolated, so
   * this is safe) to keep the database schema consistent for migrations — matching
   * how `@payloadcms/plugin-mcp` and the official plugin template behave.
   *
   * @default false
   */
  disabled?: boolean

  /**
   * The Payload collection that holds user accounts.
   * @default 'users'
   */
  userCollection?: string

  /**
   * Access rule deciding who may VIEW and MANAGE the OAuth collections
   * (`oauth-clients`, `oauth-tokens`) in the Payload admin UI and over the
   * Local API. This gates `read`, `update`, and `delete`; `create` is always
   * denied (clients self-register via Dynamic Client Registration and tokens
   * are minted by the token endpoint).
   *
   * The default authorises any authenticated user **belonging to the configured
   * `userCollection`** (`req.user?.collection === userCollection`). For the
   * standard Payload starters — where the `users` collection holds only
   * operators/admins — this is correct and secure: the public/unauthenticated
   * REST + GraphQL surface stays closed.
   *
   * ⚠️ If your `userCollection` mixes admins with untrusted end-users (e.g. a
   * single `users` collection for both staff and customers), supply your own
   * rule here — otherwise any logged-in user could rewrite a client's
   * `redirectUris` (→ auth-code theft) or revoke others' tokens.
   *
   * @default ({ req }) => Boolean(req.user) && req.user.collection === userCollection
   */
  adminAccess?: Access

  /** Lifetime of issued access tokens in seconds. @default 3600 */
  accessTokenTtlSeconds?: number

  /** Lifetime of issued refresh tokens in seconds. @default 86400 */
  refreshTokenTtlSeconds?: number

  /** Lifetime of issued auth codes in seconds. @default 300 */
  authCodeTtlSeconds?: number

  /** Per-endpoint rate-limit overrides. */
  rateLimits?: RateLimitOptions
}

export interface ResolvedConfig {
  issuer: string
  mcpPluginOptions: MCPPluginConfig
  userCollection: string
  adminAccess: Access
  accessTokenTtlSeconds: number
  refreshTokenTtlSeconds: number
  authCodeTtlSeconds: number
  rateLimits: RateLimitOptions
}

export class PayloadMcpOAuthError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'PayloadMcpOAuthError'
    this.code = code
  }
}

export class OAuthInvalidTokenError extends Error {
  constructor() {
    super('OAuth token validation failed')
    this.name = 'OAuthInvalidTokenError'
  }
}
