# ADR-0004: Consent UI Strategy

**Status:** Accepted  
**Date:** 2026-05-29  
**References:** OAuth 2.1 draft §4.1, MCP auth spec, ADR-0001 (upstream contract)

---

## Context

The authorization code flow requires a consent screen where users approve or deny an MCP client's request to access their Payload data. We need to decide where this screen lives, how unauthenticated users reach it, what it shows, and what the audit trail records.

---

## Decisions

### 1. Consent screen lives inside Payload admin

**Decision:** The consent screen is rendered at `/api/oauth/authorize` (the OAuth authorize endpoint), which redirects to the Payload admin login if the user is not authenticated. After login, the user is redirected back to complete the consent flow.

**Rationale:**
- Payload admin already handles session management, CSRF protection, and authenticated routing. Reusing it avoids implementing a parallel auth system.
- Users of a Payload-based MCP server are typically admin users. The Payload admin is where they already manage their accounts.
- The admin login page (`/admin/login`) is well-tested and hardened by the Payload project. We don't need to build our own.
- This keeps the OAuth server and the identity provider co-located — simpler mental model for deployers.

**Alternative considered:** A standalone login page outside Payload admin. Rejected because it duplicates auth infrastructure and requires managing a second session store.

### 2. Unauthenticated user flow

When `GET /api/oauth/authorize` is hit by an unauthenticated user:

1. The `state`, `client_id`, `redirect_uri`, `code_challenge`, `code_challenge_method`, and `scope` parameters are validated first (malformed requests are rejected immediately, before any redirect).
2. A short-lived session token is stored server-side (or as a signed cookie) encoding the validated authorize parameters.
3. The user is redirected to Payload admin login: `/admin/login?redirect=/api/oauth/authorize/resume?session={token}`.
4. After successful login, Payload redirects to `/api/oauth/authorize/resume?session={token}`.
5. The resume endpoint reconstructs the authorize params from the session token and renders the consent screen.

The session token is a short-lived (10-minute) HMAC-signed value. It does not contain sensitive OAuth parameters directly in the URL — only a server-side lookup key.

**Security note:** The `redirect` parameter passed to Payload admin login is validated to be `/api/oauth/authorize/resume` — it cannot be an arbitrary URL. This prevents the Payload login page from becoming an open redirector.

### 3. Consent screen contents

The consent screen is a React component (`ConsentScreen.tsx`) rendered server-side as an HTML response from `/api/oauth/authorize` (when the user is authenticated).

```
┌─────────────────────────────────────────────┐
│  [Payload Site Name]                        │
│                                             │
│  "Claude" wants to access your account     │
│                                             │
│  This will allow Claude to:                 │
│  ✓ Read and write Posts                    │
│  ✓ Read Categories                         │
│  ✓ Read Users                              │
│                                             │
│  Logged in as: you@example.com              │
│                                             │
│  [  Deny  ]        [  Allow  ]             │
└─────────────────────────────────────────────┘
```

**Content details:**
- **App name:** `client_name` from the `oauth-clients` record (HTML-escaped). Falls back to `client_id` if no name was registered.
- **Capability list:** Derived from the `scope` parameter, mapped to human-readable strings per collection/global. e.g. scope `posts:read posts:write` → "Read and write Posts". Scope mapping is configurable in plugin options.
- **Logged-in user:** Display name or email of the authenticated Payload user, to confirm which account is being authorized.
- **Buttons:** "Allow" (POST to `/api/oauth/consent` with `decision=allow`) and "Deny" (POST with `decision=deny`).

The form uses a CSRF token (Payload's built-in CSRF protection via double-submit cookie or same-site cookies). No inline scripts.

### 4. Security headers on the consent screen

The consent screen response must set:

```
X-Frame-Options: DENY
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'
Referrer-Policy: strict-origin-when-cross-origin
Cache-Control: no-store, no-cache
```

`frame-ancestors 'none'` and `X-Frame-Options: DENY` together prevent clickjacking attacks regardless of whether the browser supports one or both directives.

`unsafe-inline` for styles is acceptable for admin UI components that use Payload's Tailwind-based styling; no inline scripts are permitted.

### 5. POST /api/oauth/consent — handling the decision

The consent submission endpoint:

- Validates the CSRF token.
- Re-validates the session (user still logged in, session not expired).
- Validates `decision` is `allow` or `deny`.
- **Allow path:** Issues an auth code (T3.3), redirects to `redirect_uri?code={code}&state={state}`.
- **Deny path:** Redirects to `redirect_uri?error=access_denied&error_description=User+denied+access&state={state}` (RFC 6749 §4.1.2.1).

The redirect always goes to the registered `redirect_uri` — it is re-validated against the `oauth-clients` record at consent time, not just at authorize time.

### 6. Audit trail

Every consent interaction is logged via Payload's logger (T8.2 format):

| Event | Fields logged |
|-------|--------------|
| Authorize request received | `client_id`, `scope`, `ip`, `user_agent` |
| User redirected to login | `client_id`, `ip` |
| Consent screen shown | `client_id`, `user_id`, `scope` |
| User approved | `client_id`, `user_id`, `scope`, `auth_code_id` (hash, not plaintext) |
| User denied | `client_id`, `user_id` |

No token plaintexts, no verifiers, no code values appear in logs. Auth code IDs are logged as their stored hash, not the plaintext code.

### 7. Scope model

For 0.1.0, scopes map directly to the MCPAccessSettings capabilities from ADR-0001 §5:

| Scope | MCPAccessSettings key | Meaning |
|-------|----------------------|---------|
| `{slug}:read` | `{camelCasedSlug}.find` | Read documents in collection |
| `{slug}:write` | `{camelCasedSlug}.create`, `.update`, `.delete` | Write documents |
| `globals:{slug}:read` | `{camelCasedSlug}.find` | Read global |
| `globals:{slug}:write` | `{camelCasedSlug}.update` | Update global |

Scopes requested by the client are validated against the capabilities enabled in `MCPPluginConfig.collections` / `MCPPluginConfig.globals`. A client cannot request a scope for a capability the Payload instance has not enabled in `payloadMcp()`.

---

## Open question for T6.1

The consent screen is rendered from the `/api/oauth/authorize` endpoint (a Payload custom endpoint). Payload custom endpoints return `Response` objects — not Next.js page components. The `ConsentScreen.tsx` will be rendered to an HTML string using React's server-side `renderToString` and returned as a `text/html` response. This avoids routing complexity but means the page does not use Next.js hydration. This is acceptable for the consent screen, which requires no client-side interactivity beyond a form submit.
