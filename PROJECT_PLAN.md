# Project Plan: `payload-plugin-mcp-oauth`

> A companion plugin for `@payloadcms/plugin-mcp` that adds OAuth 2.1 authentication, enabling Payload-backed MCP servers to be used as Custom Connectors in Claude.ai (web and mobile) alongside the existing API-key flow used by Claude Code and Claude Desktop.

---

## 1. Project Overview

### 1.1 Goal

Deliver a production-grade Payload CMS plugin that:

- Adds an OAuth 2.1 + PKCE + Dynamic Client Registration auth pathway to the existing `@payloadcms/plugin-mcp` MCP endpoint.
- Is **purely additive**: API-key auth keeps working unchanged for existing users.
- Is installable as a sibling plugin (`plugins: [payloadMcp({...}), payloadMcpOAuth({...})]`).
- Is secure, well-tested, well-documented, and suitable for publication on npm under the BrainWeb organisation.

### 1.2 Non-goals (this version)

- Replacing or forking `@payloadcms/plugin-mcp`.
- Supporting OAuth flows other than authorization-code + PKCE + refresh-token (no implicit, no client_credentials, no device flow).
- Supporting OAuth providers other than Payload's own user collection as the identity source.
- A general-purpose OAuth server for non-MCP use.

### 1.3 Success criteria

1. A Payload project with both plugins installed can be added as a Custom Connector in Claude.ai using only the server URL — no manual client ID/secret.
2. Existing Claude Code / Claude Desktop setups using API keys continue to work without changes.
3. All security checks in §7 pass on every PR.
4. Test coverage ≥ 85% on auth-critical modules; ≥ 75% overall.
5. The package can be installed clean (`pnpm add @brainweb/payload-plugin-mcp-oauth`) and reach a working OAuth handshake in under 15 minutes following the README.

---

## 2. Architecture Summary

### 2.1 Composition model

```
incomingConfig
    │
    ▼
@payloadcms/plugin-mcp   ── registers: collections, MCP endpoint, API-key auth
    │
    ▼
@brainweb/payload-plugin-mcp-oauth   ── wraps MCP endpoint handler,
    │                                   adds OAuth endpoints + collections
    ▼
finalConfig
```

The companion plugin runs **after** `payloadMcp()` and:

- Locates the existing MCP endpoint by path and method.
- Wraps its handler so that if a Bearer token has an OAuth prefix, it is validated and the resolved user is attached to `req` in the exact shape the original handler expects.
- Adds OAuth metadata, registration, authorize, token, and revocation endpoints.
- Adds collections for `oauth-clients`, `oauth-tokens`, `oauth-auth-codes`.
- Adds an admin consent screen.

### 2.2 Auth path discrimination

OAuth tokens use the prefix `pmoauth_` (Payload-MCP-OAuth). The wrapper checks the Bearer value: if it starts with the prefix it takes the OAuth path; otherwise it delegates to the original API-key path unchanged.

### 2.3 Tech stack

- **Language:** TypeScript (strict mode).
- **Build:** `tsup` (ESM + CJS dual output, declaration files).
- **Runtime peer deps:** `payload ^3.x`, `@payloadcms/plugin-mcp` (pinned version range).
- **OAuth crypto:** `jose` for JWT (refresh tokens), Node `crypto` for token generation and constant-time comparison. No bespoke crypto.
- **Validation:** `zod` for all config and request input.
- **Tests:** `vitest` (unit + integration), `@playwright/test` (admin UI), MCP Inspector for smoke.
- **Lint/format:** `eslint` (typescript-eslint), `prettier`.
- **Release:** `changesets` + GitHub Actions.

---

## 3. Repository Layout (target)

```
.
├── .github/
│   ├── workflows/           # CI, release, security
│   ├── ISSUE_TEMPLATE/
│   └── SECURITY.md
├── docs/
│   ├── adrs/                # Architecture Decision Records
│   ├── installation.md
│   ├── configuration.md
│   ├── security.md
│   └── threat-model.md
├── examples/
│   └── payload-app/         # Reference Payload 3 app (SQLite) for integration testing
├── packages/
│   └── plugin/              # @brainweb/payload-plugin-mcp-oauth (the published package)
│       ├── src/
│       │   ├── index.ts             # Plugin factory
│       │   ├── plugin.ts            # Config mutation logic
│       │   ├── collections/
│       │   ├── endpoints/
│       │   ├── lib/                 # Crypto, token, PKCE utilities
│       │   ├── middleware/          # Handler wrapping
│       │   ├── admin/               # Consent screen + admin components
│       │   └── types.ts
│       ├── test/
│       │   ├── unit/
│       │   ├── integration/
│       │   └── e2e/
│       ├── package.json
│       └── tsconfig.json
├── CHANGELOG.md
├── README.md
├── package.json             # Workspace root
├── tsconfig.base.json       # Shared TS config
└── PROJECT_PLAN.md
```

---

## 4. Working With Code Agents

### 4.1 Task hygiene

Each atomic task in §6 is intended as a single PR:

- One branch per task, named `task/<id>-<slug>` (e.g. `task/t4-3-dynamic-client-registration`).
- Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`, `sec:`).
- PR description includes: task ID, acceptance criteria with checkboxes, security considerations addressed, testing evidence.
- CI must pass before merge. No exceptions for "small" changes.

### 4.2 Definition of Done (applies to every task)

A task is complete only when **all** of the following are true:

- [ ] Acceptance criteria met.
- [ ] Unit tests written and passing where applicable (≥85% coverage on new auth-critical code).
- [ ] Integration tests passing where applicable.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` all green.
- [ ] No new high/critical vulnerabilities introduced (`pnpm audit`, Semgrep, gitleaks).
- [ ] Security considerations from §7 reviewed and addressed.
- [ ] Public API has TSDoc comments.
- [ ] Relevant documentation updated.
- [ ] Changeset added if user-visible.

### 4.3 Agent prompt template

When dispatching a task to Claude Code, include:

```
TASK: <T-id> <title>
CONTEXT: PROJECT_PLAN.md §<phase> and any referenced ADRs
DEPENDENCIES: <prior task ids that must be merged>
OBJECTIVE: <copied from task>
DELIVERABLE: <copied from task>
ACCEPTANCE: <copied from task>
DOD: PROJECT_PLAN.md §4.2
```

---

## 5. Phase Roadmap

| Phase | Theme                          | Output                                     |
|-------|--------------------------------|--------------------------------------------|
| 0     | Foundation                     | Repo, tooling, CI scaffolding              |
| 1     | Research & ADRs                | Decision records, audit of upstream plugin |
| 2     | Schemas & storage              | OAuth collections                          |
| 3     | Crypto & token utilities       | Pure functions, fully unit-tested          |
| 4     | OAuth endpoints                | The HTTP surface                           |
| 5     | Plugin wiring                  | Config mutation + handler wrap             |
| 6     | Admin UI                       | Consent screen + token management          |
| 7     | Testing                        | Unit, integration, E2E, conformance        |
| 8     | Security hardening             | Threat-model verification, pen-test, scans |
| 9     | Documentation                  | README, security doc, examples             |
| 10    | Release                        | npm, GitHub release, community announce   |

Phases are roughly sequential but tasks within a phase often parallelise. Dependencies are explicit on each task.

---

## 6. Atomic Tasks

Each task below is sized for a single code-agent session (roughly 1–4 hours of focused work). Sequence respects the listed dependencies.

### Phase 0 — Foundation

**T0.1 — Initialise repository**
- *Deps:* none.
- *Objective:* Create the repository with the layout in §3, a `package.json` declaring scope `@brainweb`, MIT license, Node ≥ 20 engine, and `pnpm` as the package manager.
- *Deliverable:* Committed initial structure, README stub, LICENSE, `.gitignore`, `.editorconfig`, `.nvmrc`.
- *Acceptance:* `pnpm install` succeeds on a clean clone.

**T0.2 — TypeScript + build pipeline**
- *Deps:* T0.1.
- *Objective:* Configure `tsconfig.json` with strict mode, set up `tsup` to produce ESM + CJS + `.d.ts` outputs, define `exports` field correctly in `package.json`.
- *Deliverable:* `pnpm build` produces a `dist/` consumable by both ESM and CJS Payload projects.
- *Acceptance:* A minimal smoke test imports the (empty) plugin function from both ESM and CJS contexts.

**T0.3 — Lint, format, commit hooks**
- *Deps:* T0.2.
- *Objective:* ESLint with `typescript-eslint` and `eslint-plugin-security`, Prettier, `lint-staged` + `husky` pre-commit, `commitlint` for Conventional Commits.
- *Deliverable:* All hooks wired; `pnpm lint` and `pnpm format` work.
- *Acceptance:* A commit with a non-conventional message is rejected locally.

**T0.4 — Continuous Integration**
- *Deps:* T0.3.
- *Objective:* GitHub Actions workflow `ci.yml` running on PR and push to main: matrix on Node 20/22, runs `pnpm install --frozen-lockfile`, `typecheck`, `lint`, `test`, `build`.
- *Deliverable:* Green CI on a trivial PR.
- *Acceptance:* PRs cannot be merged with red CI (branch protection rule documented in README).

**T0.5 — Security tooling in CI**
- *Deps:* T0.4.
- *Objective:* Add jobs for: `pnpm audit` (fail on high/critical), Semgrep (`p/owasp-top-ten`, `p/typescript`, `p/nodejs`), gitleaks for secret scanning, CodeQL for SAST.
- *Deliverable:* `security.yml` workflow.
- *Acceptance:* Workflow fails on a planted test secret and a planted vulnerable dep, then passes when removed.

**T0.6 — Dependency hygiene automation**
- *Deps:* T0.4.
- *Objective:* Configure Renovate (preferred) or Dependabot with grouping for dev deps and a separate channel for `@payloadcms/*` and `payload` peers.
- *Deliverable:* `renovate.json` committed; first PR opened by bot.
- *Acceptance:* Bot PRs receive automated test runs.

**T0.7 — Example Payload application**
- *Deps:* T0.2.
- *Objective:* In `examples/payload-app/`, scaffold a minimal Payload 3 project (SQLite) that installs `@payloadcms/plugin-mcp` and (eventually) this plugin from the local workspace.
- *Deliverable:* `pnpm --filter example dev` boots a working Payload admin.
- *Acceptance:* Existing MCP API-key flow works against this example before any OAuth code is written. This is the integration-test baseline.

---

### Phase 1 — Research & Architecture Decision Records

**T1.1 — Audit upstream `@payloadcms/plugin-mcp`**
- *Deps:* T0.7.
- *Objective:* Document the exact contract we depend on: endpoint path(s), method(s), handler signature, how the authenticated user is attached to `req`, request lifecycle, where capability toggles live, what version range we will support.
- *Deliverable:* `docs/adrs/0001-upstream-contract.md` with code references (file + line + commit SHA).
- *Acceptance:* The ADR is concrete enough that any subsequent task can be implemented without re-reading upstream source.

**T1.2 — ADR-0002: Token format & lifecycle**
- *Deps:* T1.1.
- *Objective:* Decide and document: opaque tokens vs JWTs for access tokens (recommendation: opaque, hashed at rest); JWT refresh tokens with `jti` for revocation; token TTLs (access 60 min, refresh 30 days, configurable); rotation policy on refresh; the `pmoauth_` prefix convention; how tokens are hashed (argon2id or SHA-256 with HMAC pepper — document trade-offs).
- *Deliverable:* `docs/adrs/0002-token-format.md`.
- *Acceptance:* All choices have a written rationale referencing OAuth 2.1 BCP and the MCP auth spec.

**T1.3 — ADR-0003: Client registration model**
- *Deps:* T1.1.
- *Objective:* Define the RFC 7591 Dynamic Client Registration shape we will accept, what metadata fields we persist, public vs confidential client policy (MCP clients like Claude.ai are public — no client secret, PKCE required), and whether registration is open or requires a registration access token.
- *Deliverable:* `docs/adrs/0003-client-registration.md`.
- *Acceptance:* The decision is compatible with Claude.ai's connector flow and the latest MCP auth specification.

**T1.4 — ADR-0004: Consent UI strategy**
- *Deps:* T1.1.
- *Objective:* Decide where consent lives (recommendation: inside Payload admin, reusing the existing admin session), how unauthenticated users are redirected to login, the consent screen contents (client name, requested scopes mapped to plugin-mcp capabilities), and what the audit trail records.
- *Deliverable:* `docs/adrs/0004-consent-ui.md`.
- *Acceptance:* Wireframe or low-fi diagram included.

**T1.5 — ADR-0005: Plugin order validation & failure modes**
- *Deps:* T1.1.
- *Objective:* Decide how we detect that `payloadMcp()` has been registered before us, what error we throw if not, how we handle upstream version mismatch.
- *Deliverable:* `docs/adrs/0005-plugin-order.md`.
- *Acceptance:* Includes the exact error message and remediation hint shown to developers.

**T1.6 — Threat model document**
- *Deps:* T1.1–T1.5.
- *Objective:* STRIDE-based threat model for the plugin. Identify assets (tokens, codes, user data), trust boundaries (HTTP edge, Payload internal), threats (token theft, CSRF, open redirect, code injection, replay, timing attacks, IDOR on token collection), mitigations for each.
- *Deliverable:* `docs/threat-model.md`.
- *Acceptance:* Every threat has either a planned mitigation linked to a task in this plan, or an explicit accepted-risk note.

---

### Phase 2 — Collections & storage

**T2.1 — `oauth-clients` collection**
- *Deps:* T1.3, T0.7.
- *Objective:* Define a Payload collection storing registered clients: `client_id`, `client_name`, `redirect_uris[]`, `grant_types[]`, `response_types[]`, `token_endpoint_auth_method`, `software_id`, `software_version`, `created_at`, `last_used_at`, `is_active`. Access control: admin-only read in admin UI; no public API listing.
- *Deliverable:* `packages/plugin/src/collections/clients.ts` + tests.
- *Acceptance:* Collection registers cleanly in the example app; admin can view but not edit critical fields.

**T2.2 — `oauth-auth-codes` collection**
- *Deps:* T1.2, T0.7.
- *Objective:* Short-lived (60 s) one-time auth codes: `code_hash`, `client_id`, `user_id`, `redirect_uri`, `scope`, `code_challenge`, `code_challenge_method`, `expires_at`, `consumed_at`. Indexed on `code_hash`.
- *Deliverable:* `packages/plugin/src/collections/auth-codes.ts` + tests.
- *Acceptance:* Inserting a duplicate consumed code is impossible; a sweeper hook removes expired codes.

**T2.3 — `oauth-tokens` collection**
- *Deps:* T1.2, T0.7.
- *Objective:* Access and refresh tokens: `token_hash`, `token_type` (`access`|`refresh`), `client_id`, `user_id`, `scope`, `capabilities` (mirrors plugin-mcp's capability toggles), `expires_at`, `revoked_at`, `last_used_at`, `parent_token_id` (for refresh-rotation chains). Indexed on `token_hash` and `user_id`.
- *Deliverable:* `packages/plugin/src/collections/tokens.ts` + tests.
- *Acceptance:* Revoking a refresh token cascades to its access tokens; lookups by `token_hash` are O(log n).

**T2.4 — Token storage utilities**
- *Deps:* T2.3.
- *Objective:* Pure functions for `hashToken(plaintext): string` and `compareTokenHash(plaintext, hash): boolean` (constant-time). HMAC-SHA-256 with a server-side pepper from env (`PMOAUTH_TOKEN_PEPPER`). Document why we don't use argon2 for tokens (high request volume, tokens are already high-entropy).
- *Deliverable:* `packages/plugin/src/lib/token-storage.ts` + 100% unit coverage.
- *Acceptance:* Timing-attack resistance verified by a microbench test (variance under threshold).

---

### Phase 3 — Cryptography & token utilities

**T3.1 — Secure token generation**
- *Deps:* T2.4.
- *Objective:* `generateToken(type: 'access'|'refresh'|'code'): string` returning `pmoauth_{type}_{32-bytes-base64url}` for tokens; `pmoauth_code_{...}` for codes. Uses `crypto.randomBytes`. Length and prefix documented in ADR-0002.
- *Deliverable:* `packages/plugin/src/lib/token-generation.ts` + tests including statistical entropy spot-check.
- *Acceptance:* Two consecutive calls never collide in 100k iterations; format matches regex.

**T3.2 — PKCE verification**
- *Deps:* none.
- *Objective:* `verifyPkce(verifier: string, challenge: string, method: 'S256'): boolean`. **Reject `plain` method** with a typed error — only `S256` is supported.
- *Deliverable:* `packages/plugin/src/lib/pkce.ts` + tests covering RFC 7636 test vectors.
- *Acceptance:* Known-good and known-bad vectors all pass/fail correctly; non-S256 method throws.

**T3.3 — Auth-code issuance and consumption**
- *Deps:* T2.2, T3.1, T3.2.
- *Objective:* `issueAuthCode(payload, params)` and `consumeAuthCode(payload, code, verifier)` — the latter validates expiry, single-use (atomic update with `consumed_at`), redirect_uri match, PKCE.
- *Deliverable:* `packages/plugin/src/lib/auth-codes.ts` + tests.
- *Acceptance:* Double-spend test: two parallel consumes of the same code — exactly one succeeds.

**T3.4 — Access & refresh token issuance**
- *Deps:* T2.3, T2.4, T3.1.
- *Objective:* `issueTokenPair(payload, params)` returns `{access_token, refresh_token, expires_in, token_type, scope}`. Refresh rotation: `rotateRefreshToken()` invalidates the parent and issues a new pair.
- *Deliverable:* `packages/plugin/src/lib/tokens.ts` + tests.
- *Acceptance:* Using an already-rotated refresh token revokes the entire family (reuse detection per OAuth 2.1 BCP).

**T3.5 — Token validation**
- *Deps:* T3.4.
- *Objective:* `validateAccessToken(payload, plaintext): Promise<TokenContext | null>`. Returns user + capabilities or null. Updates `last_used_at` (best-effort, non-blocking). Constant-time on the not-found branch.
- *Deliverable:* `packages/plugin/src/lib/validate.ts` + tests.
- *Acceptance:* Expired, revoked, and unknown tokens all return null; valid token returns the right user; timing variance test passes.

---

### Phase 4 — OAuth HTTP endpoints

**T4.1 — Metadata: `/.well-known/oauth-authorization-server`**
- *Deps:* T1.2, T1.3.
- *Objective:* RFC 8414 metadata. Includes `issuer`, `authorization_endpoint`, `token_endpoint`, `registration_endpoint`, `revocation_endpoint`, `response_types_supported: ['code']`, `grant_types_supported: ['authorization_code', 'refresh_token']`, `code_challenge_methods_supported: ['S256']`, `token_endpoint_auth_methods_supported: ['none']`.
- *Deliverable:* `packages/plugin/src/endpoints/metadata-as.ts` + test.
- *Acceptance:* Output validates against an RFC 8414 schema; CORS headers correct.

**T4.2 — Metadata: `/.well-known/oauth-protected-resource`**
- *Deps:* T4.1.
- *Objective:* RFC 9728 resource metadata pointing back to the AS.
- *Deliverable:* `packages/plugin/src/endpoints/metadata-prm.ts` + test.
- *Acceptance:* MCP Inspector discovers the AS via PRM.

**T4.3 — `POST /api/oauth/register` (Dynamic Client Registration)**
- *Deps:* T2.1, T1.3.
- *Objective:* RFC 7591 minimal subset: accept `client_name`, `redirect_uris`, `token_endpoint_auth_method: 'none'`, `grant_types: ['authorization_code', 'refresh_token']`, `response_types: ['code']`. Validate, persist, return `client_id`. **No `client_secret` issued** (public clients only).
- *Deliverable:* `packages/plugin/src/endpoints/register.ts` + tests including invalid-input cases.
- *Acceptance:* Claude.ai's registration request succeeds; malformed input returns the correct RFC-7591 error.

**T4.4 — `GET /api/oauth/authorize` (consent flow start)**
- *Deps:* T2.1, T2.2, T3.2, T1.4.
- *Objective:* Validate `response_type=code`, `client_id`, `redirect_uri` (exact match against registered URIs — no prefix matching), `code_challenge`, `code_challenge_method=S256`, `state`, `scope`. If user not logged into Payload admin, redirect to Payload login with `?redirect=` back to this endpoint. Otherwise, render consent screen.
- *Deliverable:* `packages/plugin/src/endpoints/authorize.ts` + tests.
- *Acceptance:* Open-redirect attempts via `redirect_uri` are rejected; CSRF via `state` is enforced; unknown `client_id` returns the right error.

**T4.5 — `POST /api/oauth/consent` (consent submission)**
- *Deps:* T4.4, T3.3.
- *Objective:* Receive consent decision, if approved issue an auth code bound to user + client + PKCE challenge + redirect, then 302 to `redirect_uri` with `code` and `state`.
- *Deliverable:* `packages/plugin/src/endpoints/consent.ts` + tests.
- *Acceptance:* Denial path returns `access_denied` per RFC 6749 §4.1.2.1; approval issues exactly one code.

**T4.6 — `POST /api/oauth/token`**
- *Deps:* T3.3, T3.4.
- *Objective:* Handle both `grant_type=authorization_code` (with code + verifier + redirect_uri + client_id) and `grant_type=refresh_token` (with refresh + client_id). Return token pair or RFC 6749 error.
- *Deliverable:* `packages/plugin/src/endpoints/token.ts` + tests covering both grants and every error path.
- *Acceptance:* All RFC 6749 error responses correctly shaped; refresh rotation works; reuse triggers family revocation.

**T4.7 — `POST /api/oauth/revoke`**
- *Deps:* T3.5.
- *Objective:* RFC 7009. Accept `token` and optional `token_type_hint`. Revoke if owned by the calling client (verify via auth or by token contents). Idempotent — always returns 200.
- *Deliverable:* `packages/plugin/src/endpoints/revoke.ts` + tests.
- *Acceptance:* Revoking an unknown token still returns 200; revoking a refresh cascades.

**T4.8 — Rate limiting middleware**
- *Deps:* T4.3–T4.7.
- *Objective:* Per-IP and per-client_id rate limits on `/register`, `/authorize`, `/token`, `/revoke`. In-memory LRU bucket for self-hosted simplicity; pluggable interface so users can swap Redis later.
- *Deliverable:* `packages/plugin/src/middleware/rate-limit.ts` + tests.
- *Acceptance:* Burst test trips the limiter; configurable thresholds documented.

---

### Phase 5 — Plugin wiring

**T5.1 — Config schema**
- *Deps:* T1.5.
- *Objective:* `zod`-validated options: `issuer` (URL), token TTLs, rate-limit overrides, optional registration access token requirement, peer-version range, logger injection.
- *Deliverable:* `packages/plugin/src/types.ts` and validation in `packages/plugin/src/index.ts`.
- *Acceptance:* Invalid options throw at boot with a clear message; types exported for consumers.

**T5.2 — Plugin factory function**
- *Deps:* T5.1.
- *Objective:* The exported `payloadMcpOAuth(options)` returns a Payload plugin function `(incomingConfig) => updatedConfig`.
- *Deliverable:* `packages/plugin/src/index.ts`.
- *Acceptance:* Importable, type-correct, no side effects until invoked.

**T5.3 — Plugin order detection**
- *Deps:* T5.2, T1.5.
- *Objective:* Locate the upstream MCP endpoint in `incomingConfig.endpoints`. Throw the ADR-0005 error if absent. Detect upstream version from `package.json` resolution and warn if outside the supported range.
- *Deliverable:* `packages/plugin/src/plugin.ts` (order check section).
- *Acceptance:* Reordering the plugins in the example app reproduces the error.

**T5.4 — MCP endpoint handler wrapping**
- *Deps:* T5.3, T3.5.
- *Objective:* Replace `mcpEndpoint.handler` with a wrapper that: extracts Bearer; if it has the `pmoauth_` prefix, validates and attaches user (matching upstream's contract per ADR-0001); always calls the original handler. On wrapper-side validation failure, return `401` with `WWW-Authenticate: Bearer error="invalid_token"`.
- *Deliverable:* `packages/plugin/src/middleware/wrap-mcp.ts` + tests.
- *Acceptance:* API-key path unchanged; OAuth path delivers the correct user; unknown token returns 401 in spec-compliant form.

**T5.5 — Endpoint registration**
- *Deps:* T4.1–T4.8, T5.2.
- *Objective:* Push the OAuth endpoints + collections into `incomingConfig`. Ensure no path collisions.
- *Deliverable:* Complete `packages/plugin/src/plugin.ts`.
- *Acceptance:* `pnpm --filter example dev` boots cleanly with both plugins registered.

---

### Phase 6 — Admin UI

**T6.1 — Consent screen component**
- *Deps:* T4.4, T1.4.
- *Objective:* React component shown by the authorize endpoint. Displays client name, requested capabilities mapped to plain-English scopes (e.g. "Read and write Posts"), Approve/Deny buttons posting to `/api/oauth/consent`. Security headers set: `X-Frame-Options: DENY`, strict CSP, no inline scripts.
- *Deliverable:* `packages/plugin/src/admin/ConsentScreen.tsx` + Playwright test.
- *Acceptance:* Clickjacking attempt in an iframe fails; XSS in `client_name` is escaped.

**T6.2 — Active tokens admin view**
- *Deps:* T2.3.
- *Objective:* In Payload admin, surface active OAuth tokens for the logged-in user with revoke buttons. Admins see all; users see their own.
- *Deliverable:* `packages/plugin/src/admin/TokensView.tsx`.
- *Acceptance:* IDOR test: user A cannot list or revoke user B's tokens.

**T6.3 — Registered clients view**
- *Deps:* T2.1.
- *Objective:* Admin-only view of registered clients with last-used timestamp and active/inactive toggle.
- *Deliverable:* `packages/plugin/src/admin/ClientsView.tsx`.
- *Acceptance:* Non-admin Payload users get 403.

---

### Phase 7 — Testing

**T7.1 — Test framework setup**
- *Deps:* T0.4.
- *Objective:* Vitest with separate configs for unit and integration; Playwright config for admin tests; coverage via `v8` with thresholds (85% auth-critical, 75% global). Wire all into `ci.yml`.
- *Deliverable:* `vitest.config.ts`, `playwright.config.ts`, updated CI.
- *Acceptance:* Coverage falls below threshold → CI fails.

**T7.2 — Integration harness against example app**
- *Deps:* T0.7, T5.5.
- *Objective:* Helper that boots the example Payload app in-process, seeds users and clients, exposes an HTTP client. Used by all integration tests.
- *Deliverable:* `packages/plugin/test/integration/harness.ts`.
- *Acceptance:* A trivial test (hit metadata endpoint) passes consistently in CI.

**T7.3 — Happy-path OAuth flow integration test**
- *Deps:* T7.2, all of Phase 4.
- *Objective:* End-to-end: register → authorize (simulated login + consent) → token exchange → call MCP endpoint with access token → refresh → call again.
- *Deliverable:* `packages/plugin/test/integration/happy-path.test.ts`.
- *Acceptance:* Passes consistently; runs in < 30 s.

**T7.4 — Negative-path / abuse tests**
- *Deps:* T7.2.
- *Objective:* Cover every threat enumerated in the threat model: PKCE downgrade, code reuse, refresh reuse, open redirect, CSRF (missing state), expired token, revoked token, IDOR on tokens collection, mismatched redirect_uri, malformed registration, rate-limit trip.
- *Deliverable:* `packages/plugin/test/integration/security.test.ts`.
- *Acceptance:* Every threat has at least one test that proves the mitigation works.

**T7.5 — API-key regression test**
- *Deps:* T7.2.
- *Objective:* Verify that the existing API-key MCP flow continues to work unchanged when our plugin is loaded.
- *Deliverable:* `packages/plugin/test/integration/api-key-regression.test.ts`.
- *Acceptance:* Identical request/response with and without our plugin loaded.

**T7.6 — MCP Inspector smoke test**
- *Deps:* T7.3.
- *Objective:* Script that launches the example app and runs `@modelcontextprotocol/inspector` against it via OAuth, asserting the handshake completes.
- *Deliverable:* `packages/plugin/test/e2e/mcp-inspector.test.ts` (optional in CI, mandatory pre-release).
- *Acceptance:* Inspector reports a successful authenticated session.

**T7.7 — Claude.ai connector E2E (manual + recorded)**
- *Deps:* T7.6.
- *Objective:* Documented manual procedure for adding the deployed example as a Custom Connector in a Claude.ai test account, plus a screen recording committed to `docs/`.
- *Deliverable:* `docs/e2e-claude-ai.md` + recording.
- *Acceptance:* Procedure reproducible by a new contributor.

**T7.8 — Performance test on validation hot path**
- *Deps:* T3.5.
- *Objective:* Benchmark `validateAccessToken` at 100/500/2000 RPS. Document p50/p95/p99 latency and the database query plan.
- *Deliverable:* `packages/plugin/test/perf/validate.bench.ts` + a short results note in `docs/`.
- *Acceptance:* p95 < 25 ms on a SQLite example with 100k tokens; results stored as a baseline for regression.

---

### Phase 8 — Security hardening & verification

**T8.1 — Security headers audit**
- *Deps:* T6.1, T4.4.
- *Objective:* Verify all HTML responses set CSP, HSTS, X-Frame-Options, Referrer-Policy, Permissions-Policy. All JSON responses set `Cache-Control: no-store` and `Pragma: no-cache`.
- *Deliverable:* `packages/plugin/src/middleware/security-headers.ts` + tests asserting presence on every endpoint.
- *Acceptance:* Mozilla Observatory–style checklist all pass.

**T8.2 — Audit logging**
- *Deps:* T4.3–T4.7.
- *Objective:* Log (via Payload's logger) every: client registration, authorize start, consent approve/deny, token issue, token refresh, token revoke, invalid token attempt. Include client_id, user_id (when known), IP, user-agent. Never log token values or codes.
- *Deliverable:* `packages/plugin/src/lib/audit.ts` + tests verifying no secret material reaches the log.
- *Acceptance:* Manual grep on logs after a happy-path run finds zero token plaintext.

**T8.3 — Secret handling review**
- *Deps:* T0.5.
- *Objective:* Document required env vars (`PMOAUTH_TOKEN_PEPPER`, etc.), enforce minimum entropy at boot, refuse to start in production with defaults.
- *Deliverable:* Boot-time check in `packages/plugin/src/index.ts`; section in `docs/configuration.md`.
- *Acceptance:* Boot fails fast on a missing or weak pepper in `NODE_ENV=production`.

**T8.4 — Dependency audit & SBOM**
- *Deps:* T0.5.
- *Objective:* `pnpm audit --prod --json` clean; generate CycloneDX SBOM on release; document the supply-chain policy (review of new direct deps).
- *Deliverable:* `sbom.json` generation step in release workflow; `docs/supply-chain.md`.
- *Acceptance:* Release fails if SBOM generation fails or audit reports high/critical.

**T8.5 — Penetration test checklist run**
- *Deps:* All of Phase 4 + T8.1.
- *Objective:* Manual run against the example deployment using OWASP ASVS L2 checklist for authentication, session management, and access control. Document findings and remediations.
- *Deliverable:* `docs/pentest-report.md` (kept in repo, redacted as needed).
- *Acceptance:* All findings either fixed before release or accepted with documented justification.

**T8.6 — Responsible disclosure policy**
- *Deps:* none.
- *Objective:* Write `SECURITY.md` with a disclosure email, expected response time, and scope.
- *Deliverable:* `.github/SECURITY.md`.
- *Acceptance:* Listed in repo's Security tab.

---

### Phase 9 — Documentation

**T9.1 — README**
- *Deps:* T5.5.
- *Objective:* Concise overview, installation, minimal config example, link to docs/. Badges for CI, coverage, npm.
- *Deliverable:* `README.md`.
- *Acceptance:* A developer can install and reach a working OAuth handshake from README alone.

**T9.2 — Installation guide**
- *Deps:* T9.1.
- *Objective:* Step-by-step: install peer dep, register plugins in correct order, set env vars, expose endpoints behind HTTPS.
- *Deliverable:* `docs/installation.md`.

**T9.3 — Configuration reference**
- *Deps:* T5.1.
- *Objective:* Every option, every env var, defaults, examples. Generated from Zod where possible.
- *Deliverable:* `docs/configuration.md`.

**T9.4 — Security considerations**
- *Deps:* T1.6, T8.5.
- *Objective:* What this plugin protects against, what it does not, deployment requirements (HTTPS, secret rotation, monitoring), how to revoke compromised tokens.
- *Deliverable:* `docs/security.md`.

**T9.5 — Upgrade & compatibility guide**
- *Deps:* T1.1.
- *Objective:* Supported `@payloadcms/plugin-mcp` versions, what to do when the upstream version changes, how we test compatibility.
- *Deliverable:* `docs/compatibility.md`.

**T9.6 — Contribution guide**
- *Deps:* none.
- *Objective:* How to run tests, the DoD checklist, the security disclosure process, the ADR process.
- *Deliverable:* `CONTRIBUTING.md`.

---

### Phase 10 — Release

**T10.1 — Changesets setup**
- *Deps:* T0.4.
- *Objective:* `@changesets/cli` configured; PRs without a changeset (or `chore:`/`docs:` exemption) fail CI.
- *Deliverable:* `.changeset/config.json` + CI check.

**T10.2 — Publish workflow**
- *Deps:* T10.1, T8.4.
- *Objective:* On merge to main with pending changesets, open a Version PR; on merge of that PR, build, run full test suite, generate SBOM, publish to npm with provenance (`--provenance`), create GitHub release with notes.
- *Deliverable:* `.github/workflows/release.yml`.
- *Acceptance:* Dry-run publish succeeds on a release candidate tag.

**T10.3 — `0.1.0` release**
- *Deps:* All prior tasks merged.
- *Objective:* Cut the first public version.
- *Acceptance:* Package installable from npm; example app upgrades to the published version and continues to pass tests.

**T10.4 — Community announcement**
- *Deps:* T10.3.
- *Objective:* Post in Payload Discord + write a short BrainWeb blog post + open a discussion on the Payload repo signalling intent for upstream PR consideration.
- *Deliverable:* Drafts of all three.

**T10.5 — Upstream PR (optional, post-release)**
- *Deps:* T10.3 + ≥ 4 weeks of stable use.
- *Objective:* Open a draft PR to `payloadcms/payload` proposing the OAuth layer be merged into `plugin-mcp` as an optional feature.
- *Deliverable:* PR with rationale, diff, and migration story.

---

## 7. Cross-Cutting Security Checklist

Every PR must answer "no concerns" or "addressed by [task / line]" to each of these. The checklist is a PR template entry.

- [ ] **Input validation:** All request inputs Zod-validated; unknown fields rejected.
- [ ] **Output encoding:** All HTML output escapes user-controlled data; JSON responses use `JSON.stringify` (no template literal injection).
- [ ] **Authentication:** No new endpoint accepts requests without explicit auth or documented public-by-design rationale.
- [ ] **Authorization:** Access-control checks at the data layer; never trust route-level guards alone.
- [ ] **Cryptography:** No new bespoke crypto. Tokens via `crypto.randomBytes`; comparisons via `crypto.timingSafeEqual`; hashing via documented primitives.
- [ ] **PKCE:** `S256` only; `plain` always rejected with `invalid_request`.
- [ ] **Redirect URIs:** Exact-match comparison; no scheme-relative, no path-prefix matching.
- [ ] **CSRF:** `state` required and verified on every authorize → redirect round trip.
- [ ] **Open redirect:** No 3xx to a URL not in the registered allow-list.
- [ ] **Timing attacks:** Constant-time comparisons on all token/code lookups; no early-exit branches that leak validity.
- [ ] **Replay:** Auth codes single-use (atomic); refresh tokens rotated with family revocation on reuse.
- [ ] **Session fixation:** No session ID accepted in URL; Payload's existing protections respected.
- [ ] **Information disclosure:** Error responses follow RFC 6749 — no stack traces, no DB internals, no token echoes.
- [ ] **Logging:** No secrets, tokens, codes, verifiers, or full request bodies in logs. Audit events present per T8.2.
- [ ] **Rate limiting:** Every public endpoint covered by T4.8 or has a documented exemption.
- [ ] **Headers:** Security headers from T8.1 present on every response.
- [ ] **Dependencies:** No new direct dep without a license + supply-chain note in the PR.
- [ ] **Secrets in code:** None. Gitleaks scan clean.

---

## 8. Testing Strategy Summary

| Layer       | Tool                       | Scope                                                             | Coverage target |
|-------------|----------------------------|-------------------------------------------------------------------|------------------|
| Unit        | Vitest                     | Pure functions: crypto, PKCE, token utils, validators            | ≥ 90%            |
| Integration | Vitest + example app       | OAuth endpoints, plugin wiring, full flows, regressions          | ≥ 85%            |
| Security    | Vitest (negative tests)    | One test per threat in the threat model                          | 100% of threats  |
| UI          | Playwright                 | Consent screen, admin views, clickjacking, XSS                   | All admin pages  |
| Smoke       | MCP Inspector              | OAuth handshake completes end-to-end                             | Pre-release      |
| E2E         | Manual (recorded)          | Claude.ai connector add → tool call                              | Pre-release      |
| Performance | Vitest bench               | Token validation hot path under load                             | p95 < 25 ms      |

CI runs unit + integration + security + UI on every PR. Smoke, E2E, and performance run on release candidates.

---

## 9. CI/CD Pipeline Summary

**On every PR:**
1. `pnpm install --frozen-lockfile`
2. `pnpm typecheck`
3. `pnpm lint`
4. `pnpm test` (unit + integration + security + UI)
5. Coverage gate
6. `pnpm audit` (fail on high/critical)
7. Semgrep (OWASP Top 10, TypeScript, Node)
8. CodeQL
9. gitleaks
10. `pnpm build`
11. Changeset present (unless docs-only)

**On merge to main (with pending changesets):**
- Open / update Version PR via changesets

**On merge of Version PR:**
- Full test suite
- Generate SBOM
- `npm publish --provenance`
- GitHub release with auto-generated notes

---

## 10. Glossary & References

- **MCP** — Model Context Protocol. <https://modelcontextprotocol.io>
- **PKCE** — Proof Key for Code Exchange. RFC 7636.
- **DCR** — Dynamic Client Registration. RFC 7591.
- **AS Metadata** — RFC 8414.
- **Protected Resource Metadata** — RFC 9728.
- **Token Revocation** — RFC 7009.
- **OAuth 2.1 BCP** — draft-ietf-oauth-v2-1.
- **STRIDE** — Spoofing, Tampering, Repudiation, Information disclosure, Denial of service, Elevation of privilege.
- **OWASP ASVS** — Application Security Verification Standard. <https://owasp.org/www-project-application-security-verification-standard/>

---

*Plan version 1.0 — Authored as the initial planning artefact for `@brainweb/payload-plugin-mcp-oauth`. Subsequent material decisions belong in `docs/adrs/`. Material changes to this plan itself should be made via PR with the `meta:plan` label.*