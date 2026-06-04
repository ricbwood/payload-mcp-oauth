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

> **Installing with an AI coding agent?** Point it at
> [`INSTALL_FOR_AGENTS.md`](./INSTALL_FOR_AGENTS.md) (shipped in this
> npm package) — a step-by-step playbook with per-step verification and the
> failure modes to watch for. Or just follow the manual steps below.

---

## Requirements

| | Version |
|---|---|
| `payload` | `^3.0.0` |
| `@payloadcms/plugin-mcp` | `^3.0.0` (tested 3.85.0) |
| `next` | `^14 \|\| ^15 \|\| ^16` (only for the exported proxy/middleware) |
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

### 3. Add the proxy (Next.js 16) / middleware (Next.js 14–15)

OAuth discovery (`/.well-known/...`) and bare-host MCP connectors need two
host-level URL rewrites that a Payload plugin cannot register on its own. The
plugin ships them as a ready-made request handler — wire it up with the file
convention your Next.js version uses (next to your `app/` directory). Re-export
the handler, but declare `config` as a **local** literal.

**Next.js 16+** — Next renamed the `middleware` convention to `proxy`. Create
`src/proxy.ts`:

```ts
export { mcpOAuthMiddleware as proxy } from '@brainwebuk/payload-plugin-mcp-oauth/middleware'

export const config = {
  matcher: [
    '/',
    '/.well-known/oauth-authorization-server',
    '/.well-known/oauth-protected-resource',
  ],
}
```

**Next.js 14–15** — the `proxy` convention doesn't exist yet; create
`src/middleware.ts` with the same body, exported as `middleware`:

```ts
export { mcpOAuthMiddleware as middleware } from '@brainwebuk/payload-plugin-mcp-oauth/middleware'

export const config = {
  matcher: [
    '/',
    '/.well-known/oauth-authorization-server',
    '/.well-known/oauth-protected-resource',
  ],
}
```

> ⚠️ **Don't re-export `config`** (e.g. `export { ..., config } from '…/middleware'`).
> Next.js parses the matcher at compile time and, as of **Next 16**, hard-errors
> with *"can't recognize the exported `config` field … it mustn't be reexported"*
> — which 500s **every** route in your app. The matcher must be a static literal
> in your `proxy.ts` / `middleware.ts` itself.
>
> On Next 16 a `middleware.ts` still works but logs a deprecation warning — prefer
> `proxy.ts`. Migrate an existing file with `npx @next/codemod middleware-to-proxy .`.

Already have a proxy/middleware? Compose it instead (shown for Next 16; on 14–15
name the file `middleware.ts` and the function `middleware`):

```ts
import type { NextRequest } from 'next/server'
import { createMcpOAuthMiddleware } from '@brainwebuk/payload-plugin-mcp-oauth/middleware'

const mcpOAuth = createMcpOAuthMiddleware() // accepts { apiRoute, mcpEndpointPath, ... }

export function proxy(request: NextRequest) {
  // ...your logic first...
  return mcpOAuth(request)
}

export const config = {
  matcher: ['/', '/.well-known/oauth-authorization-server', '/.well-known/oauth-protected-resource' /* + yours */],
}
```

> No `next.config.ts` rewrites are required — the proxy/middleware handles discovery.

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

Commit the updated `src/app/(payload)/admin/importMap.js` (drop the `src/` prefix
if your app doesn't use a `src` directory).

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
| `/.well-known/...` returns the app's HTML / 404 | `proxy.ts` / `middleware.ts` missing or its `matcher` doesn't include the well-known paths (step 3). |
| **Every** route 500s; log says *"can't recognize the exported `config` field … it mustn't be reexported"* | `config` was re-exported from `…/middleware` instead of declared as a local literal in your `proxy.ts` / `middleware.ts` (step 3). |
| `The "middleware" file convention is deprecated` warning (Next 16) | Rename `src/middleware.ts` → `src/proxy.ts` and export the handler as `proxy` (step 3). |
| Admin `/oauth/tokens` or `/oauth/clients` view fails to load | Import map not regenerated (step 5). |
| Boots fine in dev, throws on deploy | `PMOAUTH_TOKEN_PEPPER` not set in production (step 4). |

---

## License

MIT
