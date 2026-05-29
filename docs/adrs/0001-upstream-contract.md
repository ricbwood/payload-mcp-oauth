# ADR-0001: Upstream `@payloadcms/plugin-mcp` Contract

**Status:** Accepted  
**Date:** 2026-05-29  
**Audited version:** `@payloadcms/plugin-mcp@3.85.0` (monorepo `payloadcms/payload`, directory `packages/plugin-mcp`)

---

## Context

Before any implementation work can begin, we need to understand the exact contract exposed by the upstream plugin. This ADR documents every integration point our plugin depends on, with references to specific files and line numbers in the audited version.

---

## 1. Package identity

| Property | Value |
|----------|-------|
| npm package | `@payloadcms/plugin-mcp` |
| Audited version | `3.85.0` |
| Repository | `https://github.com/payloadcms/payload.git` |
| Monorepo directory | `packages/plugin-mcp` |
| Plugin slug (registered) | `@payloadcms/plugin-mcp` |
| Plugin execution order | `10` (via `definePlugin({ order: 10 })`) |

Supported version range for this plugin: `^3.x` (i.e. `>=3.0.0 <4.0.0`). Breaking changes within the minor/patch range are possible but uncommon for Payload plugins.

---

## 2. Endpoint registration

**Source:** `dist/index.js` lines 53–74

Two endpoints are pushed onto `config.endpoints` when the plugin is not disabled:

```
POST /api/mcp   — primary MCP transport (Streamable HTTP)
GET  /api/mcp   — always returns {"jsonrpc":"2.0","error":{"code":-32000,"message":"Method not allowed."},...}
```

Payload prepends its API route prefix automatically. The prefix defaults to `/api` but is configurable via `MCPHandlerOptions.basePath` (which itself falls back to `payload.config.routes?.api || '/api'`). **Source:** `dist/mcp/getMcpHandler.js` line 219.

The handler factory is `initializeMCPHandler(pluginOptions)` — it is called once at plugin registration time and returns an async handler function. **Source:** `dist/endpoints/mcp.js` line 5.

---

## 3. Handler signature

**Source:** `dist/endpoints/mcp.js`

```typescript
type MCPHandler = (req: PayloadRequest) => Promise<Response>
```

`PayloadRequest` is Payload's augmented `Request` extending the standard Web `Request`. The plugin augments it with one additional field:

```typescript
// dist/index.d.ts line 4
interface PayloadRequest {
  payloadAPI: 'GraphQL' | 'local' | 'MCP' | 'REST';
}
```

`req.payloadAPI` is set to `'MCP'` on line 11 of `dist/endpoints/mcp.js`, before any auth logic runs.

---

## 4. Authentication — the critical integration point

**Source:** `dist/endpoints/mcp.js` lines 12–41

### 4.1 Default API-key flow

1. Reads `Authorization: Bearer <token>` from request headers.
2. HMAC-SHA-256 hashes the token using `payload.secret` as the key.
3. Looks up the hash in the `payload-mcp-api-keys` collection (`apiKeyIndex` field, `depth: 1`).
4. If no doc found → throws `UnauthorizedError` (becomes HTTP 401).
5. Returns `docs[0]` as `MCPAccessSettings` — the full API-key document including `user`.
6. Sets `user.collection = pluginOptions.userCollection` and `user._strategy = 'mcp-api-key'` on the resolved user.

### 4.2 The `overrideAuth` extension hook

`MCPPluginConfig` exposes an official override for authentication:

```typescript
// dist/types.d.ts line 276
overrideAuth?: (
  req: PayloadRequest,
  getDefaultMcpAccessSettings: (overrideApiKey?: null | string) => Promise<MCPAccessSettings>
) => MCPAccessSettings | Promise<MCPAccessSettings>;
```

The branch at `dist/endpoints/mcp.js` line 41:

```javascript
const mcpAccessSettings = pluginOptions.overrideAuth
  ? await pluginOptions.overrideAuth(req, getDefaultMcpAccessSettings)
  : await getDefaultMcpAccessSettings();
```

`overrideAuth` is read at **request time** from the `pluginOptions` object captured in the handler closure — not at plugin registration time. This matters for implementation strategy (see §7).

`getDefaultMcpAccessSettings` is passed as a second argument, allowing `overrideAuth` to delegate to the API-key path for non-OAuth tokens. It accepts an optional `overrideApiKey` string to substitute the header value.

---

## 5. `MCPAccessSettings` — the resolved auth object

**Source:** `dist/types.d.ts` lines 341–374

```typescript
type MCPAccessSettings = {
  user: TypedUser;                                     // REQUIRED — used throughout getMcpHandler
  auth?: {
    auth?: boolean; forgotPassword?: boolean; login?: boolean;
    resetPassword?: boolean; unlock?: boolean; verify?: boolean;
  };
  collections?: { create?: boolean; delete?: boolean; find?: boolean; update?: boolean; };
  config?: { find?: boolean; update?: boolean; };
  custom?: Record<string, boolean>;
  globals?: { find?: boolean; update?: boolean; };
  jobs?: { create?: boolean; run?: boolean; update?: boolean; };
  'payload-mcp-prompt'?: Record<string, boolean>;
  'payload-mcp-resource'?: Record<string, boolean>;
  'payload-mcp-tool'?: Record<string, boolean>;
} & Record<string, unknown>;
```

Per-collection capability flags are accessed via camelCased slug keys on the `MCPAccessSettings` object. **Source:** `dist/mcp/getMcpHandler.js` line 78:

```javascript
const toolCapabilities = mcpAccessSettings?.[`${toCamelCase(enabledCollectionSlug)}`];
// e.g. for slug 'blog-posts': mcpAccessSettings.blogPosts?.create
```

Our `overrideAuth` implementation must return an `MCPAccessSettings` with at minimum `user` populated, and the relevant capability flags set according to the OAuth token's stored scope/capabilities.

### 5.1 User object requirements

The `user` field must be a `TypedUser` with two extra properties set:

```typescript
user.collection = pluginOptions.userCollection;  // default: 'users'
user._strategy = 'mcp-api-key';                 // can be any string; we use 'mcp-oauth'
```

`user` is passed directly to all tool handlers: `createResourceTool(server, req, user, ...)`. The user identity is used by Payload's access control functions for each collection operation.

---

## 6. Collections added by the upstream plugin

| Slug | Purpose |
|------|---------|
| `payload-mcp-api-keys` | Stores API keys with per-capability access flags and an associated user |

Our three collections (`oauth-clients`, `oauth-auth-codes`, `oauth-tokens`) must not collide with this slug or any Payload built-in slugs.

---

## 7. Integration strategy and open question

### 7.1 Preferred approach: `overrideAuth` via shared reference

The cleanest integration is to inject our OAuth validation logic via `overrideAuth`. The handler closure reads `pluginOptions.overrideAuth` at request time. If we can obtain the same object reference that the handler captured — either by:

- Reading `config.plugins['@payloadcms/plugin-mcp']` (if Payload's `definePlugin` stores and passes the same object reference), or
- Using a module-level shared mutable container that `overrideAuth` closes over

…then mutating `overrideAuth` after the handler is created will be picked up correctly.

**This must be verified empirically in T5.3** by inspecting whether `config.plugins['@payloadcms/plugin-mcp']` is the same reference as the `pluginOptions` captured in the handler.

### 7.2 Fallback approach: endpoint handler wrapping

If the reference is not shared, we wrap the endpoint handlers directly:

1. Locate `config.endpoints` entries with `path === '/mcp'` (both POST and GET).
2. Replace each `.handler` with a wrapper function.
3. In the wrapper: if `Bearer` token starts with `pmoauth_`, validate against our `oauth-tokens` collection, build `MCPAccessSettings` with user + capabilities, and serve the MCP response. Otherwise, delegate `req` to the original handler unchanged.

The fallback requires building our own MCP response path for OAuth tokens (using `createMcpHandler` from the `mcp-handler` package, which is a public transitive dependency). This is more implementation work but avoids relying on object identity.

### 7.3 Plugin order detection

Our plugin detects that the upstream plugin has been registered before it by checking:

1. `config.plugins?.['@payloadcms/plugin-mcp']` is defined (preferred — uses the registered plugins interface).
2. `config.endpoints?.some(e => e.path === '/mcp')` as a fallback.

If neither is present, we throw a clear startup error (defined in ADR-0005).

---

## 8. `MCPPluginConfig` — capability toggles

**Source:** `dist/types.d.ts` lines 4–281

The full config type is `MCPPluginConfig`. Fields relevant to capability control:

| Field | Type | Purpose |
|-------|------|---------|
| `collections` | `Partial<Record<CollectionSlug, { enabled: ... }>>` | Which collections to expose and which CRUD ops |
| `globals` | `Partial<Record<GlobalSlug, { enabled: ... }>>` | Which globals to expose |
| `experimental.tools` | `{ auth?, collections?, config?, jobs? }` | Experimental tool groups (dev-only) |
| `userCollection` | `CollectionSlug` | Which collection holds users; defaults to `'users'` |
| `overrideAuth` | see §4.2 | Auth override hook |
| `overrideApiKeyCollection` | `(CollectionConfig) => CollectionConfig` | Escape hatch for API key collection customisation |

Our OAuth token's stored `capabilities` field (T2.3) must mirror the `MCPAccessSettings` shape so that when we build the access settings object from a validated token we produce correctly shaped data.

---

## 9. Request lifecycle (end-to-end)

```
HTTP POST /api/mcp
  ↓
Payload router matches endpoint
  ↓
mcpHandler(req: PayloadRequest)  [dist/endpoints/mcp.js:6]
  ↓  req.payloadAPI = 'MCP'
  ↓
overrideAuth(req, getDefault) OR getDefault()  [line 41]
  → returns MCPAccessSettings
  ↓
getMCPHandler(pluginOptions, mcpAccessSettings, req)  [line 51]
  → builds MCP server with tools filtered by access settings
  ↓
createRequestFromPayloadRequest(req)  [line 52]
  → new Request(req.url, { body, headers, method })
  ↓
handler(request)  [line 54]
  → MCP protocol processing (Streamable HTTP)
  ↓
Response
```

The `globalThis.Request` / `globalThis.Response` save-and-restore block (lines 48–66) is an internal workaround for a `@hono/node-server` globalThis mutation inside `@modelcontextprotocol/sdk`. Our code does not need to replicate or interact with this.

---

## 10. Version compatibility policy

- **Supported range:** `@payloadcms/plugin-mcp@^3.x`
- **Breaking signals:** changes to the `overrideAuth` signature, the `MCPAccessSettings` type, endpoint path, or `config.endpoints` registration pattern.
- **Detection:** T5.3 will read the installed version at boot and warn if outside the tested range (`>=3.85.0 <4.0.0` initially, widened as we verify older versions).
- **Re-audit trigger:** any semver-minor or major bump to `@payloadcms/plugin-mcp` should re-run this audit and update this ADR.
