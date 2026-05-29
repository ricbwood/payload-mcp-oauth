# ADR-0005: Plugin Order Validation & Failure Modes

**Status:** Accepted  
**Date:** 2026-05-29  
**References:** ADR-0001 (upstream contract §7)

---

## Context

Our plugin wraps the MCP endpoint registered by `@payloadcms/plugin-mcp`. If our plugin runs before the upstream plugin, the endpoint does not yet exist and the wrap would silently fail (or crash). We need a fast-fail mechanism with a developer-friendly error message, and a strategy for detecting upstream version mismatches.

---

## Decisions

### 1. Detection strategy — dual check

When `payloadMcpOAuth(options)` runs as a Payload plugin `(incomingConfig) => updatedConfig`, it performs two checks:

**Check A — registered plugin slug:**
```typescript
const registeredMcp = incomingConfig.plugins?.['@payloadcms/plugin-mcp'];
if (!registeredMcp) { /* throw */ }
```

Payload's `definePlugin` stores the plugin's options under its slug in `config.plugins` when the plugin runs. If this key is absent, `payloadMcp` has not run yet.

**Check B — MCP endpoint present (fallback):**
```typescript
const hasMcpEndpoint = incomingConfig.endpoints?.some(
  (e) => e.path === '/mcp' && e.method === 'post'
);
```

This is a belt-and-suspenders check in case the `definePlugin` slug storage behaviour changes between Payload versions.

Both checks must pass. If either fails, the startup error is thrown.

### 2. Error thrown when plugin order is wrong

```
PayloadMcpOAuthError: @brainweb/payload-plugin-mcp-oauth must be registered AFTER @payloadcms/plugin-mcp in your Payload plugins array.

  Fix: Change your payload.config.ts plugins array to:

    plugins: [
      payloadMcp({ ... }),       // ← first
      payloadMcpOAuth({ ... }),  // ← second
    ],

  Current state: @payloadcms/plugin-mcp endpoint was not found.
  This usually means payloadMcpOAuth was placed before payloadMcp in the plugins array,
  or payloadMcp is not installed.
```

The error class is `PayloadMcpOAuthError` (exported from the package so consumers can catch it specifically). It extends `Error` with a `code: 'PLUGIN_ORDER'` property.

This error is thrown synchronously during config processing (not at request time), so it surfaces immediately on server start — not on first request.

### 3. Version mismatch warning

After the order check passes, we read the installed version of `@payloadcms/plugin-mcp` from its `package.json`:

```typescript
import mcpPkg from '@payloadcms/plugin-mcp/package.json' assert { type: 'json' };
const installedVersion = mcpPkg.version; // e.g. '3.85.0'
```

The tested version range is exported as a constant:
```typescript
export const TESTED_MCP_VERSION_RANGE = '>=3.85.0 <4.0.0';
```

If the installed version is outside this range:

- **Below minimum (`<3.85.0`):** Throw `PayloadMcpOAuthError` with `code: 'VERSION_TOO_OLD'`.
  ```
  PayloadMcpOAuthError: @payloadcms/plugin-mcp@{version} is below the minimum tested version (3.85.0).
  Please upgrade: pnpm add @payloadcms/plugin-mcp@^3
  ```

- **At or above major boundary (`>=4.0.0`):** Log a warning (do not throw — the plugin may still work):
  ```
  [payload-plugin-mcp-oauth] WARNING: @payloadcms/plugin-mcp@{version} is above the tested range (>=3.85.0 <4.0.0).
  The OAuth plugin may not function correctly. Check for a newer version of @brainweb/payload-plugin-mcp-oauth.
  ```
  Throwing on a major bump would be overly aggressive — it would break deployments on upgrade before a fix is released. A warning allows the deployer to proceed while being informed.

- **Within range:** No log message.

### 4. `overrideAuth` already set — conflict detection

If `incomingConfig.plugins['@payloadcms/plugin-mcp']?.overrideAuth` is already set (by some other plugin or custom code), we:

1. Log a warning:
   ```
   [payload-plugin-mcp-oauth] WARNING: overrideAuth is already set on @payloadcms/plugin-mcp config.
   The OAuth plugin will wrap the existing overrideAuth. If this is unexpected, ensure only one auth override is registered.
   ```
2. Wrap the existing `overrideAuth` so both run: first ours (for `pmoauth_` tokens), then the original for everything else.

We do not throw, because the wrapping is safe and the warning is sufficient.

### 5. Missing `PMOAUTH_TOKEN_PEPPER` in production

If `process.env.NODE_ENV === 'production'` and `process.env.PMOAUTH_TOKEN_PEPPER` is absent or fewer than 32 characters:

```
PayloadMcpOAuthError: PMOAUTH_TOKEN_PEPPER environment variable is missing or too short.
  In production, this variable must be set to a random string of at least 32 characters.
  Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  code: 'MISSING_PEPPER'
```

In development (non-production), a default insecure pepper is used with a console warning so developers don't need to configure the env var to run locally.

### 6. Summary of error codes

| Code | Thrown / Warned | Condition |
|------|-----------------|-----------|
| `PLUGIN_ORDER` | Thrown | `payloadMcp` not found in config |
| `VERSION_TOO_OLD` | Thrown | `plugin-mcp` version below `3.85.0` |
| `VERSION_UNTESTED` | Warning | `plugin-mcp` version at or above `4.0.0` |
| `OVERRIDE_AUTH_CONFLICT` | Warning | `overrideAuth` already set on MCPPluginConfig |
| `MISSING_PEPPER` | Thrown (prod only) | `PMOAUTH_TOKEN_PEPPER` missing or too short |
