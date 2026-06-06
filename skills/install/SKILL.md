---
name: install
description: >-
  Install and configure @brainwebuk/payload-plugin-mcp-oauth — OAuth 2.1 + PKCE +
  Dynamic Client Registration for a Payload @payloadcms/plugin-mcp server, so it
  can be added as a Custom Connector in Claude.ai. Use when adding OAuth to a
  Payload MCP app; wiring the plugin, proxy/middleware, or env; or debugging the
  install (consent 401 "Authentication required", SQLite push "no such column:
  oauth_clients_id", missing OAuth admin collections, "must be registered AFTER
  mcpPlugin", or OAuth tokens 401 while API keys work).
---

# Install `@brainwebuk/payload-plugin-mcp-oauth`

Adds OAuth 2.1 + PKCE + Dynamic Client Registration to an existing
`@payloadcms/plugin-mcp` MCP server. **Additive** — the API-key flow keeps
working. Always prefer the **latest** version (the install path has had several
fixes; use `>= 0.3.3`).

## Prerequisites
- A Payload v3 app with `@payloadcms/plugin-mcp` already installed and working.
- Next.js 14 / 15 / 16 (for the exported proxy/middleware).

## Steps

1. **Install:** `pnpm add @brainwebuk/payload-plugin-mcp-oauth`

2. **Register it AFTER `mcpPlugin()`, sharing ONE options object** (most common footgun):
   ```ts
   const mcpOptions = {
     collections: { posts: { enabled: { find: true, create: true, update: true } } },
   }
   plugins: [
     mcpPlugin(mcpOptions),
     payloadMcpOAuth({
       issuer: process.env.NEXT_PUBLIC_SERVER_URL!,
       mcpPluginOptions: mcpOptions, // ← the SAME reference, never a copy/spread
     }),
   ]
   ```
   A copy/spread silently breaks OAuth token auth (API keys keep working, so it's
   easy to miss). Registering it *before* `mcpPlugin()` throws on boot.

3. **Add the proxy** — Next 16: `src/proxy.ts`; Next 14/15: `src/middleware.ts`.
   Re-export the handler but declare `config` as a **local literal** (never
   re-export `config` — it 500s every route on Next 16):
   ```ts
   export { mcpOAuthMiddleware as proxy } from '@brainwebuk/payload-plugin-mcp-oauth/middleware'
   export const config = {
     matcher: ['/', '/.well-known/oauth-authorization-server', '/.well-known/oauth-protected-resource'],
   }
   ```

4. **Env:** set `NEXT_PUBLIC_SERVER_URL` (public HTTPS origin; used as the OAuth
   issuer) and `PMOAUTH_TOKEN_PEPPER` (`openssl rand -hex 32`; required ≥ 32 chars
   in production). Ensure Payload's `serverURL` equals `NEXT_PUBLIC_SERVER_URL` —
   the consent flow relies on a first-party session cookie matching that origin.

5. **Apply the schema** — pick ONE workflow, don't mix:
   - **Dev push** (SQLite/Postgres in dev): just start the app.
   - **Migrations** (production): `pnpm payload migrate:create` then `pnpm payload migrate`.
   If you already booted the app once **before** installing, on SQLite either
   upgrade to `>= 0.3.2` or reset the dev DB (`rm your.db*`) so the schema is
   created fresh.

## Verify
- `curl <issuer>/.well-known/oauth-authorization-server` returns JSON metadata.
- In the admin, the **MCP** nav group shows **OAuth Clients** and **OAuth Tokens**
  (when logged in as a user of your `userCollection`).

## Make it usable for AI agents (recommended)
Agents only know what the server tells them. On `mcpPlugin()` set top-level
`instructions` (how to use the server + non-obvious field rules), per-collection
`description`, and field `admin.description` (these flow into the generated tool
schemas). For gnarly create flows, define an MCP `prompt`. A Claude *Skill*
cannot reach a connecting web agent — `instructions`/`prompts` are the
protocol-native bridge.

## Common failures → fixes
- **Consent Approve → `401 access_denied / "Authentication required"`** — upgrade
  to `>= 0.3.1` (a `Referrer-Policy: no-referrer` bug made the browser send
  `Origin: null`). If it persists, `serverURL`/`NEXT_PUBLIC_SERVER_URL` must
  exactly match the browser origin (scheme, host, no trailing slash).
- **`SQLITE_ERROR: no such column: oauth_clients_id`** (rebuilding
  `payload_locked_documents_rels`) — upgrade to `>= 0.3.2`, or reset the dev DB,
  or add the plugin before the first boot.
- **OAuth tokens 401 but API keys work** — `mcpPluginOptions` wasn't the *same*
  object reference passed to both plugins.
- **`must be registered AFTER mcpPlugin()`** — fix plugin order. (On `>= 0.3.3`
  it's fine to leave `payloadMcpOAuth` registered while the MCP plugin is
  `disabled` — it no-ops instead of crashing.)
- **A tool like `createPages` is missing** — enable that op in
  `collections.<slug>.enabled` (`create`/`update`/`delete`); `enabled: true`
  turns on all of them.

For the full reference see the package's `INSTALL_FOR_AGENTS.md` and README.
