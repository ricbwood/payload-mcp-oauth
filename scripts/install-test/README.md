# From-scratch packaged install test

Reproduces a **real install of the published plugin** into a fresh Payload app and
verifies the end state is a working site with working OAuth. It exists because the
hard part of this plugin is the *install wiring*, not the runtime — and the unit
tests + the pre-wired `examples/payload-app` (which consumes the plugin via
`workspace:*`) can't catch wiring/packaging regressions.

```bash
pnpm test:install            # full run, temp dir cleaned up on success
pnpm test:install -- --keep  # keep the temp app even on success, for debugging
```

### See it running in a browser

`serve` provisions the site the **same way** the test does (shared
`lib/provision.mjs`), then leaves `next dev` running so you can click around —
including the OAuth admin views — instead of running the handshake:

```bash
pnpm test:install:serve              # http://localhost:3000
pnpm test:install:serve -- --port 4000
pnpm test:install:serve -- --reuse   # keep the last install (faster restart)
```

It prints the admin URL and a seeded login (`install-test@example.com` /
`install-test-password-123`). The app lives at `<tmp>/pmoauth-serve/app` and is
**reprovisioned from the freshly packed plugin on every launch by default**, so you
can never click around a stale build (the false positive that masked the #33
locked-collection regression — see issue #43). Pass `--reuse` to keep the prior
install (node_modules + DB) for a fast restart when you *know* the plugin is
unchanged. Press Ctrl+C to stop.

## What it does

1. **Build + `pnpm pack`** the plugin → a real `.tgz`, identical to `npm publish`.
2. **Isolated install** — copies `examples/payload-app` to a temp dir *outside* the
   workspace, repoints the dependency `workspace:*` → `file:<tgz>`, and runs a clean
   `pnpm install`. This exercises the actual published artifact, not the source.
3. Drives the documented install steps and asserts each one.

## Pain points it asserts (the reason it exists)

| Check | Pain point |
|---|---|
| `.`, `/middleware`, `/admin` subpaths resolve + export | **Packaging** — bad `exports`/`files`, missing dist subpaths |
| `importMap.js` injects **no** custom admin components (OAuth screens are native collections) | **Import map / admin views** |
| `oauth-clients` / `oauth-auth-codes` / `oauth-tokens` are queryable after boot | **DB migrations / schema push** |
| Full handshake: bare `/.well-known/*` JSON → register → login → authorize → consent → token → **`/api/mcp` accepts the `pmoauth_` token** | **Wiring gotchas** — the "same `mcpOptions` object" / plugin-order trap surfaces as a 401 here |
| Unauthenticated `/api/mcp` → 401 with `WWW-Authenticate: …resource_metadata` | MCP wrapper |
| Admin nav surfaces **OAuth Clients / OAuth Tokens** under the **MCP** group and their list routes render for an admin | **Admin visibility** — the #33 regression that hid the OAuth screens |
| Unauthenticated `GET /api/oauth-clients` / `/api/oauth-tokens` → 401/403 | **Access gating** — the public REST surface stays denied |
| `NODE_ENV=production` without `PMOAUTH_TOKEN_PEPPER` refuses to boot | **Env** |

## Files

- `run.mjs` — the test orchestrator (provision → assert → boot → handshake).
- `serve.mjs` — provision and leave `next dev` running for manual inspection.
- `lib/provision.mjs` — shared provisioning (build → pack → install → importmap →
  migrate) used by both, so the served site matches the tested one.
- `lib/handshake.mjs` — reusable HTTP OAuth + PKCE handshake and wrapper assertions.
- `lib/admin-checks.mjs` — asserts the user-visible admin outcome (OAuth collections
  visible under the MCP nav group + list routes render) and that the public REST
  surface stays denied.
- `fixtures/install-seed.mjs` — runs inside the temp app (via `tsx`) to push the
  schema, assert the OAuth collections exist, and seed an admin user.

## Notes / tradeoffs

- The temp app is the example app repointed to the tarball, so its *wiring is the
  reference wiring*. The handshake succeeding proves wiring + import map + schema +
  env are all correct end to end. It does not re-type the README wiring from a blank
  app — the value is verifying the published package installs and runs, on every change.
- First run is slow (a full `pnpm install` + `next dev` cold compile); allow a couple
  of minutes. On failure the temp app path is printed and left in place.
