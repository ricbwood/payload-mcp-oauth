#!/usr/bin/env node
// From-scratch packaged install test.
//
// Reproduces installing the PUBLISHED plugin artifact into a fresh Payload app
// and verifies you end up with a working site + working OAuth, asserting hardest
// on the four install pain points: packaging, import map, db migrations, wiring.
// The provisioning (build → pack → install → importmap → migrate) is shared with
// the `serve` command via ./lib/provision.mjs.
//
// Usage:  node scripts/install-test/run.mjs   (or: pnpm test:install)
//         --keep   keep the temp dir even on success (for debugging)

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  ADMIN,
  LOCKFILE,
  freePort,
  provisionApp,
  restoreLockfile,
  run,
  startDevServer,
  waitForServer,
} from './lib/provision.mjs'
import { runHandshake } from './lib/handshake.mjs'

const KEEP = process.argv.includes('--keep')
const lockfileSnapshot = readFileSync(LOCKFILE, 'utf8')

// ---- assertion bookkeeping -------------------------------------------------
const checks = []
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail })
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail && !ok ? `\n      → ${detail}` : ''}`)
}

// ---- main ------------------------------------------------------------------
let tmp
let server
try {
  tmp = mkdtempSync(path.join(tmpdir(), 'pmoauth-install-'))
  const appDir = path.join(tmp, 'app')
  const port = await freePort()

  // 1. Provision the real published artifact into an isolated app.
  console.log('\n[1/6] Provisioning (build → pack → install → importmap → migrate)…')
  const { baseUrl, appEnv, tgzPath, importMapContent, seedResult } = await provisionApp({
    appDir,
    port,
    log: (m) => console.log(`   • ${m}`),
  })
  check('pack: produced a publishable .tgz', !!tgzPath, tgzPath)
  check('install: clean install under strict-peer-deps (documented peerDependencyRules remedy) succeeded', true)

  // 2. Packaging: the three published subpaths must resolve through the exports
  //    map to files that exist. We RESOLVE rather than import — /middleware and
  //    /admin pull in next/react, which only resolve inside the bundler, not
  //    under plain Node — so importing them here would be a false negative. We
  //    do import the server-only `.` entry to confirm it executes and exports.
  console.log('\n[2/6] Verifying published entry points resolve…')
  const probe = [
    "import { createRequire } from 'node:module'",
    'const require = createRequire(process.cwd() + "/package.json")',
    "const pkg = '@brainwebuk/payload-plugin-mcp-oauth'",
    "for (const sub of ['', '/middleware', '/admin']) require.resolve(pkg + sub)",
    'const m = await import(pkg)',
    "if (typeof m.payloadMcpOAuth !== 'function') throw new Error('missing payloadMcpOAuth export')",
  ].join(';')
  try {
    await run('node', ['--input-type=module', '-e', probe], { cwd: appDir })
    check('packaging: . , /middleware and /admin subpaths all resolve via exports map', true)
  } catch (err) {
    check('packaging: . , /middleware and /admin subpaths all resolve via exports map', false, String(err.message))
  }

  // 3. Import map: the OAuth admin views must be wired in.
  console.log('\n[3/6] Checking the admin import map…')
  check(
    'importmap: references the plugin admin views (TokensView/ClientsView)',
    importMapContent.includes('payload-plugin-mcp-oauth/admin') && /Tokens|Clients/i.test(importMapContent),
    'run `payload generate:importmap` — the oauth/tokens & oauth/clients views need it',
  )

  // 4. DB migrations: the plugin's three collections must be queryable.
  console.log('\n[4/6] Checking the OAuth collections (schema push)…')
  check(
    'migrations: oauth-clients / oauth-auth-codes / oauth-tokens are queryable',
    seedResult.ok === true && Object.values(seedResult.collections ?? {}).every(Boolean),
    seedResult.error ?? String(seedResult.raw).slice(-2000),
  )

  // 5. Start the app and drive the full handshake.
  console.log('\n[5/6] Starting the app and running the OAuth + PKCE handshake…')
  server = startDevServer({ appDir, port, appEnv })
  let serverLog = ''
  server.stdout.on('data', (d) => (serverLog += d))
  server.stderr.on('data', (d) => (serverLog += d))
  const beforeHandshake = checks.length
  try {
    await waitForServer(`${baseUrl}/admin`, 180_000, server)
    await runHandshake({ baseUrl, email: ADMIN.email, password: ADMIN.password, check })
  } catch (err) {
    check('handshake: app booted and handshake ran', false, err.message)
  }
  // If anything in the handshake failed, the server log usually explains why
  // (e.g. a config/middleware compile error that 500s every route). Surface it
  // so failures are self-diagnosing rather than needing a manual repro.
  if (checks.slice(beforeHandshake).some((c) => !c.ok)) {
    console.log(`\n--- dev server log tail ---\n${serverLog.slice(-3000)}\n---------------------------`)
  }

  // 6. Production safety: no pepper must refuse to boot (env pain point).
  console.log('\n[6/6] Verifying production refuses to boot without a token pepper…')
  let prodErr = ''
  await run('node', ['--import', 'tsx', '-e', "import('./src/payload.config.ts').then(m=>m.default).then(c=>import('payload').then(p=>p.getPayload({config:c})))"], {
    cwd: appDir,
    env: { ...process.env, ...appEnv, NODE_ENV: 'production', PMOAUTH_TOKEN_PEPPER: '' },
  }).catch((e) => (prodErr = e.message))
  check(
    'env: NODE_ENV=production without PMOAUTH_TOKEN_PEPPER refuses to boot (mentioning the pepper)',
    /pepper|PMOAUTH_TOKEN_PEPPER/i.test(prodErr),
    prodErr ? `boot failed but not for the pepper:\n${prodErr.slice(-1500)}` : 'expected a boot failure but it started',
  )
} catch (err) {
  console.error(`\nInstall test aborted: ${err.stack ?? err}`)
  check('install test ran to completion', false, String(err.message ?? err))
} finally {
  if (server) {
    try {
      process.kill(-server.pid, 'SIGKILL')
    } catch {
      /* already gone */
    }
  }
  if (restoreLockfile(lockfileSnapshot)) {
    console.log('Note: restored repo pnpm-lock.yaml (a pnpm step had modified it).')
  }
  // ---- summary ----
  const failed = checks.filter((c) => !c.ok)
  console.log('\n' + '─'.repeat(60))
  console.log(`Install test: ${checks.length - failed.length}/${checks.length} checks passed`)
  if (failed.length) console.log(`Failed:\n${failed.map((c) => `  ✗ ${c.name}`).join('\n')}`)
  if (tmp && (KEEP || failed.length)) {
    console.log(`\nTemp app kept for debugging: ${path.join(tmp, 'app')}`)
  } else if (tmp) {
    rmSync(tmp, { recursive: true, force: true })
  }
  console.log('─'.repeat(60))
  process.exit(failed.length ? 1 : 0)
}
