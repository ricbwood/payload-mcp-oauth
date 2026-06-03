# Install playbook: `@brainwebuk/payload-plugin-mcp-oauth`

**Audience: an AI coding agent** (Claude, Gemini, ChatGPT/Codex, Cursor, …) asked
to install this plugin into an **existing Payload 3 + Next.js app**.

Do the steps **in order**. After each step run its **Verify** check before moving
on. If a check fails, jump to [Failure modes](#failure-modes). Don't skip the
preconditions — most install pain comes from doing steps out of order or missing
the wiring rules in Steps 2–3.

This plugin is **purely additive**: it wraps the existing `@payloadcms/plugin-mcp`
MCP endpoint and adds OAuth 2.1 + PKCE + Dynamic Client Registration so the MCP
server can be a Custom Connector in Claude.ai. The existing API-key flow keeps
working unchanged.

---

## Preconditions (check before installing)

Run these and confirm before proceeding:

```bash
# 1. This is a Payload 3 app:
node -p "require('payload/package.json').version"          # expect ^3

# 2. @payloadcms/plugin-mcp is installed AND mcpPlugin() is registered in
#    payload.config.* — this plugin has nothing to wrap otherwise:
node -p "require('@payloadcms/plugin-mcp/package.json').version"  # expect ^3
grep -R "mcpPlugin(" --include=payload.config.* -l .

# 3. Detect the Next.js major — this decides Step 3 (proxy vs middleware):
node -p "require('next/package.json').version"             # 14, 15, or 16+

# 4. Node >= 20:
node -v
```

If `@payloadcms/plugin-mcp` is missing or `mcpPlugin()` is not registered, install
and configure that first — then return here.

---

## Step 1 — Install the package

```bash
pnpm add @brainwebuk/payload-plugin-mcp-oauth     # or: npm i / yarn add
```

**Watch out:** if the install fails with
`ERR_PNPM_PEER_DEP_ISSUES … unmet peer @modelcontextprotocol/sdk`, the host has
`strict-peer-dependencies=true`. This is a **harmless upstream version mismatch**
inside `@payloadcms/plugin-mcp` → `mcp-handler`. Don't downgrade anything. Fix by
adding to the app's `.npmrc`:

```
strict-peer-dependencies=false
```

…or to `package.json`:

```jsonc
"pnpm": { "peerDependencyRules": { "allowedVersions": { "mcp-handler>@modelcontextprotocol/sdk": "*" } } }
```

then reinstall.

**Verify:** the package is in `dependencies`.

---

## Step 2 — Register the plugin (after `mcpPlugin()`, sharing ONE options object)

Edit `payload.config.ts`. Two rules are **critical** and cause silent failures if
broken:

```ts
import { mcpPlugin } from '@payloadcms/plugin-mcp'
import type { MCPPluginConfig } from '@payloadcms/plugin-mcp'
import { payloadMcpOAuth } from '@brainwebuk/payload-plugin-mcp-oauth'
import { buildConfig } from 'payload'

// Assign ONCE and reuse the SAME reference in both calls. ⚠️
const mcpOptions: MCPPluginConfig = {
  collections: {
    // enable whatever the MCP server should expose, e.g.:
    users: { enabled: { find: true, update: true } },
    media: { enabled: { find: true, create: true } },
  },
}

export default buildConfig({
  // ...db, collections, admin, etc...
  plugins: [
    mcpPlugin(mcpOptions),
    payloadMcpOAuth({
      issuer: process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000',
      mcpPluginOptions: mcpOptions, // ← the SAME object, never a copy/spread
    }),
  ],
})
```

- **RULE A — same object reference.** Pass the *same* `mcpOptions` variable to
  both `mcpPlugin(mcpOptions)` and `payloadMcpOAuth({ mcpPluginOptions: mcpOptions })`.
  The plugin installs its OAuth token-validation hook by mutating that object. If
  you pass a fresh object / spread / copy to either call, **OAuth tokens silently
  401 while API keys keep working** — a failure that's easy to miss.
- **RULE B — order.** `payloadMcpOAuth()` must come **after** `mcpPlugin()` in the
  `plugins` array. It throws on boot otherwise.

**Verify:** the app boots without
`Error: payloadMcpOAuth must be registered AFTER mcpPlugin()`.

---

## Step 3 — Add the host-level routing (proxy on Next 16, middleware on 14/15)

OAuth discovery (`/.well-known/...`) and bare-host MCP connectors need URL
rewrites a Payload plugin can't register itself. The plugin ships the handler;
wire it up with the convention matching the Next version from the preconditions.
The file goes next to your `app/` directory (i.e. `src/proxy.ts` or
`src/middleware.ts`).

**Next.js 16+** — create `src/proxy.ts`:

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
`src/middleware.ts`, identical but exported as `middleware`:

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

- **CRITICAL — declare `config` locally; never re-export it.** Do **not** write
  `export { mcpOAuthMiddleware as proxy, config } from '…/middleware'`. Next parses
  the matcher at build time and, on **Next 16**, hard-errors with *"can't recognize
  the exported `config` field … it mustn't be reexported"* — which **500s every
  route in the app**. The `matcher` must be a static literal in this file.
- On Next 16 a `middleware.ts` still works but logs a deprecation warning — prefer
  `proxy.ts`. No `next.config` rewrites are needed.

**Verify** (after the app is running, Step 7):
`curl -s http://localhost:3000/.well-known/oauth-authorization-server` returns
**JSON** (not the app's HTML or a 404).

---

## Step 4 — Environment variables

```bash
# Public HTTPS URL clients reach. Used as the OAuth issuer + in discovery metadata.
NEXT_PUBLIC_SERVER_URL=https://cms.example.com        # http://localhost:3000 in dev

# HMAC pepper for hashing tokens at rest. REQUIRED in production (>= 32 chars).
PMOAUTH_TOKEN_PEPPER=$(openssl rand -hex 32)
```

In `NODE_ENV=production` the plugin **throws on boot** if `PMOAUTH_TOKEN_PEPPER`
is missing or shorter than 32 chars. In development an insecure fallback is used
with a warning.

**Verify:** a production build boots without a `PMOAUTH_TOKEN_PEPPER` error.

---

## Step 5 — Regenerate the admin import map

The plugin registers two admin views (issued tokens, registered clients). Payload
resolves admin components through a generated import map.

```bash
pnpm payload generate:importmap     # then commit the updated importMap.js
```

**Verify:** `app/(payload)/admin/importMap.js` now references
`@brainwebuk/payload-plugin-mcp-oauth/admin`.

---

## Step 6 — Database migrations (the plugin adds 3 collections)

The plugin adds collections **`oauth-clients`**, **`oauth-auth-codes`**, and
**`oauth-tokens`**. Their tables must be created before OAuth works.

- **If the app uses Payload migrations** (a `migrations/` dir, `payload migrate` in
  the deploy flow):

  ```bash
  pnpm payload migrate:create add_oauth_collections
  pnpm payload migrate
  ```

- **If the app uses dev push** (e.g. `@payloadcms/db-sqlite`, or Postgres in push
  mode): the schema is applied automatically the next time the app boots in dev —
  no command needed. For a production deploy with push disabled, create and run a
  migration as above.

**Verify:** the three collections are queryable, e.g. in the admin UI under
Collections, or `payload.count({ collection: 'oauth-clients' })` does not throw.

---

## Step 7 — Verify end to end

```bash
# Start the app (dev), then:
curl -s http://localhost:3000/.well-known/oauth-authorization-server   # → JSON w/ issuer, *_endpoint
curl -s http://localhost:3000/.well-known/oauth-protected-resource     # → JSON w/ authorization_servers
```

Both must return JSON. The OAuth endpoints are now live:
`/api/oauth/register`, `/api/oauth/authorize`, `/api/oauth/consent`,
`/api/oauth/token`, `/api/oauth/revoke`. OAuth tokens use the `pmoauth_` prefix;
the wrapped MCP endpoint takes the OAuth path for those and delegates everything
else to the original API-key handler.

To connect from Claude.ai: Settings → Connectors → Add custom connector → enter
the bare server URL (e.g. `https://cms.example.com`). It self-registers and runs
the OAuth + PKCE handshake, sending the user to the Payload login + a consent
screen.

---

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `pnpm add` fails: `ERR_PNPM_PEER_DEP_ISSUES … @modelcontextprotocol/sdk` | Host uses `strict-peer-dependencies=true`; harmless upstream mismatch | Step 1: set `strict-peer-dependencies=false` or add the `peerDependencyRules` allowance, reinstall |
| Boot throws `payloadMcpOAuth must be registered AFTER mcpPlugin()` | Plugin order wrong | Step 2 RULE B: put `payloadMcpOAuth()` after `mcpPlugin()` |
| OAuth tokens 401 but API keys still work | `mcpPluginOptions` wasn't the **same** object reference | Step 2 RULE A: pass one shared `mcpOptions` to both calls — no copy/spread |
| **Every** route 500s; log: *"can't recognize the exported `config` field … it mustn't be reexported"* | `config` re-exported from the plugin in `proxy.ts`/`middleware.ts` | Step 3: declare `config` as a local literal in the file |
| `/.well-known/...` returns the app's HTML or 404 | `proxy.ts`/`middleware.ts` missing, or `matcher` lacks the well-known paths | Step 3: add the file with the matcher shown |
| `The "middleware" file convention is deprecated` warning (Next 16) | Using `middleware.ts` on Next 16 | Step 3: rename to `src/proxy.ts`, export as `proxy` (or run `npx @next/codemod middleware-to-proxy .`) |
| Admin `oauth-tokens` / `oauth-clients` view fails to load | Import map not regenerated | Step 5: run `payload generate:importmap` |
| OAuth requests 500 / "no such table: oauth_*" | Schema not migrated | Step 6: run migrations or boot in dev to push |
| Boots in dev, throws on deploy | `PMOAUTH_TOKEN_PEPPER` unset in production | Step 4: set a 32+ char pepper in the production env |

---

## Plugin options (reference)

`payloadMcpOAuth({ ... })`:

| Option | Default | Notes |
|---|---|---|
| `issuer` | — (required) | Public base URL; OAuth issuer + metadata base. |
| `mcpPluginOptions` | — (required) | The **same** object passed to `mcpPlugin()`. |
| `userCollection` | `'users'` | Collection holding user accounts. |
| `accessTokenTtlSeconds` | `3600` | Access-token lifetime. |
| `refreshTokenTtlSeconds` | `86400` | Refresh-token lifetime. |
| `authCodeTtlSeconds` | `300` | Authorization-code lifetime. |
| `rateLimits` | `{}` | Per-endpoint rate-limit overrides. |
