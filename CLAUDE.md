# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`@brainwebuk/payload-plugin-mcp-oauth` is a Payload CMS plugin that adds OAuth 2.1 + PKCE + Dynamic Client Registration to `@payloadcms/plugin-mcp` MCP servers. This enables Payload-backed MCP servers to be used as Custom Connectors in Claude.ai alongside the existing API-key flow.

The plugin is **purely additive** — it wraps the existing MCP endpoint handler and adds OAuth endpoints/collections as a sibling plugin. See `PROJECT_PLAN.md` for the full architecture and phased task breakdown.

## Repository Structure

```
.
├── packages/plugin/          # @brainwebuk/payload-plugin-mcp-oauth (the published package)
│   └── src/                  # Source lives here (to be created per PROJECT_PLAN.md §3)
├── examples/payload-app/     # Reference Payload 3 app (SQLite) for integration testing
├── tsconfig.base.json        # Shared TS config (strict, ESNext, Bundler resolution)
└── PROJECT_PLAN.md           # Authoritative task list and architecture decisions
```

## Commands

All commands use `pnpm`. The workspace root scripts delegate to packages with `-r`.

```bash
# Install (run once at root)
pnpm install

# Build the plugin package only
pnpm --filter ./packages/plugin build

# Run all tests across workspace
pnpm test

# Run tests in a single package
pnpm --filter ./packages/plugin test
pnpm --filter ./examples/payload-app test:integration

# Typecheck
pnpm typecheck
pnpm --filter @brainwebuk/payload-plugin-mcp-oauth typecheck

# Lint
pnpm lint
pnpm --filter ./packages/plugin lint

# Run example app dev server
pnpm dev:example
```

## Build

The plugin uses `tsup` for dual ESM + CJS output with `.d.ts` declarations. `packages/plugin/tsconfig.json` extends the root `tsconfig.base.json` (strict mode, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`). Both packages source from `src/` and output to `dist/`.

## Key Architecture Decisions

**Composition model:** `payloadMcpOAuth()` must be registered *after* `payloadMcp()` in the Payload plugins array. The OAuth plugin locates the MCP endpoint by path/method in `incomingConfig.endpoints`, wraps its handler, and adds OAuth-specific endpoints and collections.

**Token discrimination:** OAuth tokens use the prefix `pmoauth_`. The MCP handler wrapper checks the Bearer value — if it starts with `pmoauth_` it takes the OAuth path; otherwise it delegates to the original API-key handler unchanged.

**Collections added by the plugin:** `oauth-clients`, `oauth-auth-codes`, `oauth-tokens`.

**No bespoke crypto:** Token generation via `crypto.randomBytes`, comparisons via `crypto.timingSafeEqual`, hashing via HMAC-SHA-256 with env pepper (`PMOAUTH_TOKEN_PEPPER`). Only `S256` PKCE is accepted — `plain` is always rejected.

**OAuth endpoints registered:** `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource`, `POST /api/oauth/register`, `GET /api/oauth/authorize`, `POST /api/oauth/consent`, `POST /api/oauth/token`, `POST /api/oauth/revoke`.

## Development Tasks

Atomic tasks are defined in `PROJECT_PLAN.md §6`, organized by phase (0–10). Use `PROJECT_PLAN.md §4.2` as the Definition of Done checklist for every task. Branch naming: `task/<id>-<slug>` (e.g. `task/t4-3-dynamic-client-registration`). Use Conventional Commits.

## Current State

The repo is in Phase 0 (Foundation). `packages/plugin` and `examples/payload-app` both have `package.json` and `tsconfig.json` but no `src/` directories yet. All source implementation is ahead.
