/**
 * Single source of truth for the OAuth discovery endpoint paths (RFC 8414 /
 * RFC 9728). Use these everywhere a discovery path is referenced in code:
 * endpoint registration (plugin.ts), the Next proxy rewrite (next-middleware.ts),
 * and the protected-resource-metadata URL (wrap-mcp.ts).
 *
 * NOTE: the exported Next `config.matcher` in next-middleware.ts must remain a
 * STATIC string LITERAL — Next.js statically analyses it and won't resolve
 * imported constants — so it can't reference these. A unit test asserts that
 * literal stays in sync with OAUTH_DISCOVERY_PATHS.
 */
export const OAUTH_AS_METADATA_PATH = '/.well-known/oauth-authorization-server'
export const OAUTH_PRM_METADATA_PATH = '/.well-known/oauth-protected-resource'

/** The discovery paths the Next proxy/middleware matcher must cover. */
export const OAUTH_DISCOVERY_PATHS = [OAUTH_AS_METADATA_PATH, OAUTH_PRM_METADATA_PATH] as const
