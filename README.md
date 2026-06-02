# @brainwebuk/payload-plugin-mcp-oauth

OAuth 2.1 + PKCE + Dynamic Client Registration for
[`@payloadcms/plugin-mcp`](https://www.npmjs.com/package/@payloadcms/plugin-mcp),
so a Payload-backed MCP server can be added as a **Custom Connector in Claude.ai**
alongside the existing API-key flow.

The plugin is **purely additive**: it wraps the MCP endpoint handler and adds the
OAuth endpoints, collections, and admin views. Your existing API-key MCP clients
keep working unchanged.

- OAuth 2.1 authorization-code flow with **PKCE (S256 only)**
- **Dynamic Client Registration** (RFC 7591) — Claude.ai self-registers
- Discovery via RFC 8414 / RFC 9728 well-known documents
- Tokens hashed at rest (HMAC-SHA-256); refresh + revocation supported
- Admin views for issued tokens and registered clients

---

## Requirements

| | Version |
|---|---|
| `payload` | `^3.0.0` |
| `@payloadcms/plugin-mcp` | `^3.0.0` (tested 3.85.0) |
| `next` | `^14 \|\| ^15 \|\| ^16` (only for the exported middleware) |
| Node | `>= 20` |

---

## Install

### 1. Add the package

```bash
pnpm add @brainwebuk/payload-plugin-mcp-oauth
# or: npm i / yarn add
```

### 2. Register the plugin (after `mcpPlugin`)

In `payload.config.ts`, register `payloadMcpOAuth()` **immediately after**
`mcpPlugin()`, and pass it the **same** options object you gave to `mcpPlugin()`.

```ts
import { mcpPlugin } from '@payloadcms/plugin-mcp'
import type { MCPPluginConfig } from '@payloadcms/plugin-mcp'
import { payloadMcpOAuth } from '@brainwebuk/payload-plugin-mcp-oauth'
import { buildConfig } from 'payload'

// Assign ONCE to a const and reuse the same reference in both calls. ⚠️
const mcpOptions: MCPPluginConfig = {
  collections: {
    users: { enabled: { find: true, update: true } },
    media: { enabled: { find: true, create: true } },
  },
}

export default buildConfig({
  // ...db, collections, admin, etc.
  plugins: [
    mcpPlugin(mcpOptions),
    payloadMcpOAuth({
      issuer: process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000',
      mcpPluginOptions: mcpOptions, // ← the SAME object, not a copy
    }),
  ],
})
```

> ⚠️ **Pass the same object reference to both calls.** The plugin installs its
> token-validation hook by mutating `mcpOptions`. If you pass a fresh object or a
> spread/copy to either call, OAuth tokens will silently fail to authenticate
> (the API-key path keeps working, which makes this easy to miss). The plugin
> also throws on boot if it is registered *before* `mcpPlugin()`.

### 3. Add the Next.js middleware

OAuth discovery (`/.well-known/...`) and bare-host MCP connectors need two
host-level URL rewrites that a Payload plugin cannot register on its own. The
plugin ships them as a ready-made middleware — create `src/middleware.ts` (next
to your `app/` directory) with a single re-export:

```ts
export { mcpOAuthMiddleware as middleware, config } from '@brainwebuk/payload-plugin-mcp-oauth/middleware'
```

Already have a `middleware.ts`? Compose it instead:

```ts
import { createMcpOAuthMiddleware } from '@brainwebuk/payload-plugin-mcp-oauth/middleware'

const mcpOAuth = createMcpOAuthMiddleware() // accepts { apiRoute, mcpEndpointPath, ... }

export function middleware(request) {
  // ...your logic first...
  return mcpOAuth(request)
}

export const config = {
  matcher: ['/', '/.well-known/oauth-authorization-server', '/.well-known/oauth-protected-resource' /* + yours */],
}
```

> No `next.config.ts` rewrites are required — the middleware handles discovery.

### 4. Set environment variables

```bash
# Public HTTPS URL clients reach. Used as the OAuth issuer + in discovery metadata.
NEXT_PUBLIC_SERVER_URL=https://cms.example.com

# HMAC pepper for hashing tokens at rest — REQUIRED in production (>= 32 chars).
# Generate with: openssl rand -hex 32
PMOAUTH_TOKEN_PEPPER=<64-hex-chars>
```

In development a built-in insecure pepper is used if `PMOAUTH_TOKEN_PEPPER` is
unset (with a warning). In `NODE_ENV=production` the plugin **throws on boot** if
it is missing or shorter than 32 characters.

### 5. Regenerate the admin import map

The plugin registers two admin views (issued tokens, registered clients). Payload
resolves admin components through a generated import map, so regenerate it after
installing:

```bash
pnpm payload generate:importmap
```

Commit the updated `app/(payload)/admin/importMap.js`.

### 6. Run database migrations

The plugin adds three collections — `oauth-clients`, `oauth-auth-codes`,
`oauth-tokens`. Apply your usual schema step:

```bash
pnpm payload migrate        # or your adapter's dev push on next boot
```

That's it — start the app and the OAuth endpoints are live.

---

## Connect from Claude.ai

1. Settings → **Connectors** → **Add custom connector**.
2. Enter your server URL (the bare host, e.g. `https://cms.example.com`, works —
   the middleware routes it to the MCP endpoint).
3. Claude.ai discovers the auth server, dynamically registers, and starts the
   OAuth + PKCE handshake.
4. You'll be sent to your Payload admin login + a consent screen; approve to
   issue a token.

Verify discovery is reachable:

```bash
curl https://cms.example.com/.well-known/oauth-protected-resource
curl https://cms.example.com/.well-known/oauth-authorization-server
```

---

## Configuration

| Option | Type | Default | Description |
|---|---|---|---|
| `issuer` | `string` | — (required) | Public base URL; OAuth issuer + metadata base. |
| `mcpPluginOptions` | `MCPPluginConfig` | — (required) | The **same** object passed to `mcpPlugin()`. |
| `userCollection` | `string` | `'users'` | Collection holding user accounts. |
| `accessTokenTtlSeconds` | `number` | `3600` | Access-token lifetime. |
| `refreshTokenTtlSeconds` | `number` | `86400` | Refresh-token lifetime. |
| `authCodeTtlSeconds` | `number` | `300` | Authorization-code lifetime. |
| `rateLimits` | `RateLimitOptions` | `{}` | Per-endpoint rate-limit overrides. |

### Endpoints added

`GET /.well-known/oauth-authorization-server`, `GET /.well-known/oauth-protected-resource`,
`POST /api/oauth/register`, `GET /api/oauth/authorize`, `POST /api/oauth/consent`,
`POST /api/oauth/token`, `POST /api/oauth/revoke`.

OAuth tokens use the `pmoauth_` prefix. The MCP handler checks the Bearer value:
`pmoauth_…` takes the OAuth path; anything else delegates to the original API-key
handler unchanged.

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `Error: payloadMcpOAuth must be registered AFTER mcpPlugin()` | Plugin order — put `payloadMcpOAuth()` after `mcpPlugin()`. |
| OAuth tokens 401 but API keys work | `mcpPluginOptions` wasn't the **same** object reference (step 2). |
| `/.well-known/...` returns the app's HTML / 404 | `middleware.ts` missing or its `matcher` doesn't include the well-known paths (step 3). |
| Admin `/oauth/tokens` or `/oauth/clients` view fails to load | Import map not regenerated (step 5). |
| Boots fine in dev, throws on deploy | `PMOAUTH_TOKEN_PEPPER` not set in production (step 4). |

---

## License

MIT
