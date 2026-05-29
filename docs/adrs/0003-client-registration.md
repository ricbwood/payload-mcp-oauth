# ADR-0003: Client Registration Model

**Status:** Accepted  
**Date:** 2026-05-29  
**References:** RFC 7591 (Dynamic Client Registration), MCP auth spec, Claude.ai connector flow

---

## Context

MCP clients like Claude.ai use Dynamic Client Registration (RFC 7591) to self-register before initiating an OAuth flow. We need to define what subset of RFC 7591 we support, what metadata we persist, and the client type policy.

---

## Decisions

### 1. Public clients only — no client secrets

**Decision:** We register only public clients. No `client_secret` is ever issued.

**Rationale:**
- Claude.ai (and all current MCP clients) are browser-based or user-agent-based applications that cannot safely store a client secret. Issuing one provides no security benefit and creates a false sense of security if leaked.
- OAuth 2.1 draft §2.4 recommends PKCE for all clients as a replacement for the client secret in the authorization code flow. We enforce PKCE (`S256` only) unconditionally.
- `token_endpoint_auth_method` is always `none` — clients authenticate via `client_id` + PKCE verifier only.

### 2. Accepted registration request fields (RFC 7591 subset)

| Field | Required | Validation |
|-------|----------|------------|
| `redirect_uris` | Yes | Array of ≥1 valid absolute URIs. Each must use `https://` in production. `http://localhost` and `http://127.0.0.1` are allowed for development. No wildcards, no fragment components. |
| `client_name` | No | String, max 255 chars. Displayed on the consent screen. |
| `token_endpoint_auth_method` | No | Must be `none` if provided; ignored otherwise. |
| `grant_types` | No | Must be subset of `['authorization_code', 'refresh_token']` if provided. |
| `response_types` | No | Must be `['code']` if provided. |
| `software_id` | No | UUID or opaque string. Persisted for auditing; not enforced. |
| `software_version` | No | Semver string. Persisted for auditing; not enforced. |

All other fields are ignored (not rejected) for forward compatibility with future RFC 7591 extensions.

### 3. Generated registration response fields

| Field | Value |
|-------|-------|
| `client_id` | UUID v4, generated server-side |
| `client_id_issued_at` | Unix timestamp |
| `redirect_uris` | Echo of accepted URIs |
| `grant_types` | `['authorization_code', 'refresh_token']` |
| `response_types` | `['code']` |
| `token_endpoint_auth_method` | `'none'` |

No `client_secret` or `registration_access_token` is returned.

### 4. Open registration — no registration access token

**Decision:** Registration is open (no prior authentication required to call `POST /api/oauth/register`).

**Rationale:**
- Claude.ai's connector flow requires open registration — the client has no way to obtain a registration token before the flow starts.
- The threat of unbounded client registration (DoS, spam) is mitigated by rate limiting on the `/register` endpoint (T4.8) and the fact that unregistered/unused clients carry no meaningful security risk — they cannot obtain tokens without user consent.
- If a deployer wants to restrict registration, they can set `registrationRequiresToken: true` in the plugin options (future enhancement, documented as a non-goal for 0.1.0).

### 5. Persisted collection fields (`oauth-clients`)

| Field | Type | Notes |
|-------|------|-------|
| `client_id` | UUID (PK) | Generated, immutable |
| `client_name` | string | Optional, shown on consent screen |
| `redirect_uris` | string[] | Stored as JSON array; exact-match enforced on authorize |
| `grant_types` | string[] | Always `['authorization_code', 'refresh_token']` |
| `response_types` | string[] | Always `['code']` |
| `token_endpoint_auth_method` | string | Always `'none'` |
| `software_id` | string | Optional, from registration request |
| `software_version` | string | Optional, from registration request |
| `is_active` | boolean | Admin can deactivate; deactivated clients cannot start new flows |
| `created_at` | timestamp | Auto |
| `last_used_at` | timestamp | Updated on each token exchange |

### 6. Redirect URI validation — exact match only

**Decision:** `redirect_uri` in the authorize request must exactly match one of the registered URIs. No prefix matching, no hostname matching, no wildcard expansion.

**Rationale:**
- Open-redirect attacks via prefix or wildcard matching are a well-documented class of OAuth vulnerability (see OWASP OAuth cheat sheet).
- OAuth 2.1 draft §4.1.1 requires exact match (with the exception of query string components per some interpretations — we apply strict full-URI equality to eliminate ambiguity).
- The `state` parameter provides CSRF protection; exact redirect URI match provides open-redirect protection. Both are required.

### 7. Compatibility with Claude.ai connector flow

Based on the MCP auth specification and Claude.ai's documented connector onboarding:

1. Claude.ai discovers the authorization server via `/.well-known/oauth-protected-resource` → `/.well-known/oauth-authorization-server`.
2. Claude.ai calls `POST /api/oauth/register` with `redirect_uris` pointing to Claude.ai's callback URL and `client_name: 'Claude'` (or similar).
3. Claude.ai stores the returned `client_id`.
4. Claude.ai initiates the authorization code flow using `client_id` + PKCE.

Our registration model is compatible with this flow. The redirect URI in step 2 will be a `https://` Claude.ai URL, which passes our validation.

---

## Rejected alternatives

| Alternative | Reason rejected |
|-------------|-----------------|
| Confidential clients with `client_secret` | No MCP client can safely store a secret; PKCE is the correct replacement |
| Registration access token requirement | Incompatible with Claude.ai's connector flow |
| Whitelist-only registration | Too restrictive for the general-purpose plugin use case; rate limiting is sufficient for 0.1.0 |
| Prefix/wildcard redirect URI matching | Open-redirect vulnerability; RFC 7591 and OAuth 2.1 both recommend exact match |
