# ADR-0002: Token Format & Lifecycle

**Status:** Accepted  
**Date:** 2026-05-29  
**References:** OAuth 2.1 draft-ietf-oauth-v2-1, RFC 6749, RFC 7519 (JWT), RFC 7009 (revocation), MCP auth spec

---

## Context

We need concrete decisions on how access tokens and refresh tokens are structured, stored, validated, and expired. These decisions affect security posture, database query patterns, and the complexity of the crypto layer.

---

## Decisions

### 1. Access tokens — opaque, not JWT

**Decision:** Access tokens are opaque random strings, not JWTs.

**Rationale:**
- MCP servers are stateful — every request hits our database anyway (to fetch Payload data), so the "avoid round-trips" argument for JWTs does not apply.
- Opaque tokens can be revoked instantly by deleting or marking the database row. JWTs require a blocklist or short expiry to achieve the same.
- JWTs signed with a secret expose a second secret that must be managed, rotated, and protected. Opaque tokens reduce the secret surface to the pepper alone.
- Access tokens are high-frequency (one per MCP request). At that throughput, the HMAC-SHA-256 lookup cost (microseconds) is negligible compared to the MCP operation itself.
- OAuth 2.1 draft explicitly recommends token introspection or database validation for resource servers that need fine-grained revocation.

### 2. Refresh tokens — opaque (not JWT)

**Decision:** Refresh tokens are also opaque random strings stored in the database, with rotation and family-revocation on reuse.

**Rationale:**
- Refresh tokens are lower frequency (one per token rotation, typically minutes to hours). Database cost is irrelevant.
- Keeping both token types opaque simplifies the implementation — one token storage pattern, one validation path.
- The refresh-token reuse detection (OAuth 2.1 BCP §2.2.2) is trivially implemented on opaque tokens: mark `consumed_at` and check. With JWTs this requires maintaining a `jti` blocklist, which is equivalent complexity with more moving parts.

### 3. Token format

All tokens (access, refresh, auth code) use the format:

```
pmoauth_{type}_{32-bytes-base64url}
```

Where:
- `pmoauth_` — package prefix, used by the handler wrapper to distinguish OAuth tokens from API keys (ADR-0001 §4.2)
- `{type}` — one of `at` (access), `rt` (refresh), `ac` (auth code)
- `_{32-bytes-base64url}` — 256 bits of cryptographically random entropy from `crypto.randomBytes(32).toString('base64url')`

Examples:
```
pmoauth_at_Rv8xKq3mN2...  (access token)
pmoauth_rt_uJ7pLs9nW4...  (refresh token)
pmoauth_ac_tF2qMr6kB1...  (authorization code)
```

Total length: 8 + 2 + 1 + 43 = 54 characters. Within any reasonable database column or header size limit.

**Why 32 bytes (256 bits)?**
- Provides 2^256 token space — brute-force is computationally infeasible.
- Matches the output size of SHA-256 used for hashing, so no information is truncated.
- NIST recommends ≥128 bits for random tokens; we use 256 for a comfortable margin.

### 4. Token storage — HMAC-SHA-256 hash, not plaintext

**Decision:** Only the hash of each token is stored in the database. The plaintext is returned to the client once and never stored.

Hash function: `HMAC-SHA-256(token, PMOAUTH_TOKEN_PEPPER)`

**Why HMAC over plain SHA-256?**
- A plain SHA-256 of a high-entropy token is computationally safe (no rainbow tables are feasible at 256-bit entropy). However, HMAC-SHA-256 with a server-side pepper adds a second layer: even a full database dump cannot produce working tokens without the pepper.
- Pepper is loaded from `process.env.PMOAUTH_TOKEN_PEPPER` at boot. A missing or weak pepper in production causes a fast-fail startup error (T8.3).

**Why not argon2id for tokens?**
- argon2id is appropriate for password-like secrets (user-chosen, low entropy). Tokens are 256 bits of random entropy — they do not benefit from key stretching, which only helps against low-entropy inputs.
- At MCP request rates (potentially hundreds per second), argon2id's intentional slowness (tens of milliseconds) would dominate response time. HMAC-SHA-256 takes microseconds.

**Constant-time comparison:** All hash comparisons use `crypto.timingSafeEqual` to prevent timing oracles on the database lookup.

### 5. Token TTLs

| Token type | Default TTL | Configurable |
|------------|-------------|--------------|
| Access token | 60 minutes | Yes — `accessTokenTtl` option |
| Refresh token | 30 days | Yes — `refreshTokenTtl` option |
| Auth code | 60 seconds | No — this is a security boundary, not a UX concern |

Auth codes are intentionally not configurable. 60 seconds is already generous for a browser redirect flow; shorter is safer.

### 6. Refresh token rotation & family revocation

**Decision:** Refresh tokens rotate on every use (one-time use). Reuse of a consumed refresh token revokes all tokens in the family.

- Each refresh token has a `parent_token_id` linking to the token it replaced.
- On refresh: mark old token `consumed_at`, issue new token pair, link new refresh token to the old one.
- On reuse detection (a `consumed_at` token is presented): walk the family chain and revoke all non-revoked tokens in it.

This implements the OAuth 2.1 BCP refresh token reuse detection requirement. The family-revocation is conservative: if a refresh token leaks and is used by an attacker before the legitimate client, both tokens are revoked, triggering a new authorization flow. This is the correct security outcome.

### 7. Token lifecycle state machine

```
Auth code:   [issued] → [consumed] | [expired]
                          (single use, 60 s window)

Access token:  [active] → [expired] | [revoked]
                (60 min TTL, revoked by /revoke or refresh rotation)

Refresh token: [active] → [consumed] → [rotated to new token]
                         → [revoked] (by /revoke, family revocation, or expiry)
```

### 8. Clock skew

A 30-second clock skew grace window is applied when validating `expires_at` on access tokens. This accommodates minor time drift between client and server without meaningfully extending the security window.

No clock skew is applied to auth codes — the 60-second window is already the grace period.

### 9. Token prefixes for type discrimination

The handler wrapper in T5.4 checks `bearer.startsWith('pmoauth_')` to route tokens. Downstream, the type segment (`at`, `rt`, `ac`) prevents a refresh token from being used as an access token and vice versa. Validation functions check the prefix before performing any database lookup.

---

## Rejected alternatives

| Alternative | Reason rejected |
|-------------|-----------------|
| JWT access tokens | No benefit for stateful MCP; complicates revocation |
| JWT refresh tokens with `jti` blocklist | Equal complexity to opaque + rotation; more moving parts |
| argon2id for token hashing | Wrong tool — for low-entropy passwords, not high-entropy tokens |
| PBKDF2 | Same objection as argon2id; unnecessary for 256-bit random tokens |
| No pepper (plain HMAC with fixed key) | Reduces defence-in-depth vs database dump |
| Plain SHA-256 | Safe at this entropy level but HMAC + pepper is strictly better with minimal cost |
