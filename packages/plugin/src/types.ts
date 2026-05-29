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
   */
  mcpPluginOptions: MCPPluginConfig

  /**
   * The Payload collection that holds user accounts.
   * @default 'users'
   */
  userCollection?: string

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
