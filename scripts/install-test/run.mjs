#!/usr/bin/env node
// From-scratch packaged install test.
//
// Reproduces installing the PUBLISHED plugin artifact into a fresh Payload app
// and verifies you end up with a working site + working OAuth, asserting hardest
// on the four install pain points: packaging, import map, db migrations, wiring.
//
//   1. build + `pnpm pack` the plugin  → a real .tgz (same as npm publish)
//   2. copy the example app to a temp dir OUTSIDE the workspace, repoint the
//      dependency workspace:* → file:<tgz>, and do a clean install
//   3. assert the ., /admin, /middleware subpaths resolve from node_modules
//   4. `payload generate:importmap` → assert it now wires the OAuth admin views
//   5. boot Payload (schema push) + assert the oauth-* collections are queryable
//   6. start the app and drive the full OAuth + PKCE handshake over HTTP
//   7. assert NODE_ENV=production without a pepper refuses to boot
//
// Usage:  node scripts/install-test/run.mjs   (or: pnpm test:install)
//         --keep   keep the temp dir even on success (for debugging)

import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:net'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runHandshake } from './lib/handshake.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '../..')
const pluginDir = path.join(repoRoot, 'packages/plugin')
const exampleApp = path.join(repoRoot, 'examples/payload-app')
const KEEP = process.argv.includes('--keep')

// Guard the repo lockfile: pnpm commands run inside the temp app (even with
// --ignore-workspace) can occasionally rewrite the monorepo lockfile. We snapshot
// it up front and restore it on exit so the test never leaves the repo dirty.
const lockfilePath = path.join(repoRoot, 'pnpm-lock.yaml')
const lockfileSnapshot = readFileSync(lockfilePath, 'utf8')

const ADMIN = { email: 'install-test@example.com', password: 'install-test-password-123' }

// ---- assertion bookkeeping -------------------------------------------------
const checks = []
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail })
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail && !ok ? `\n      → ${detail}` : ''}`)
}

// ---- small process helpers -------------------------------------------------
function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts })
    let out = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (out += d))
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} ${args.join(' ')} exited ${code}\n${out.slice(-4000)}`)))) // tail
  })
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })
}

async function waitForServer(url, timeoutMs, child) {
  const deadline = Date.now() + timeoutMs
  let exited = false
  child?.on('close', () => (exited = true))
  while (Date.now() < deadline) {
    if (exited) throw new Error('dev server exited before becoming ready')
    try {
      await fetch(url)
      return
    } catch {
      await new Promise((r) => setTimeout(r, 1000))
    }
  }
  throw new Error(`server not ready after ${timeoutMs}ms at ${url}`)
}

// ---- main ------------------------------------------------------------------
let tmp
let server
try {
  // 1. Build + pack the plugin exactly as it would publish.
  console.log('\n[1/7] Building and packing the plugin…')
  await run('pnpm', ['--filter', '@brainwebuk/payload-plugin-mcp-oauth', 'build'], { cwd: repoRoot })
  const packOut = await run('pnpm', ['pack', '--pack-destination', tmpdir()], { cwd: pluginDir })
  const tgz = packOut.trim().split('\n').map((l) => l.trim()).reverse().find((l) => l.endsWith('.tgz'))
  if (!tgz) throw new Error(`could not find .tgz in pnpm pack output:\n${packOut}`)
  const tgzPath = path.isAbsolute(tgz) ? tgz : path.join(tmpdir(), path.basename(tgz))
  check('pack: produced a publishable .tgz', !!tgz, tgzPath)

  // 2. Copy the example app to an isolated temp dir and repoint the dependency
  //    to the packed tarball, so the install exercises the real artifact.
  console.log('\n[2/7] Creating an isolated app and installing the packed tarball…')
  tmp = mkdtempSync(path.join(tmpdir(), 'pmoauth-install-'))
  const appDir = path.join(tmp, 'app')
  const EXCLUDE = new Set(['node_modules', '.next', 'dist', 'playwright-report', 'test-results', 'dev.db', 'payload.db'])
  cpSync(exampleApp, appDir, {
    recursive: true,
    filter: (src) => !EXCLUDE.has(path.basename(src)) && !path.basename(src).endsWith('.db'),
  })
  // Copy the in-app seed fixture next to package.json so tsx can import the config.
  cpSync(path.join(here, 'fixtures/install-seed.mjs'), path.join(appDir, 'install-seed.mjs'))

  const pkgPath = path.join(appDir, 'package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  pkg.dependencies['@brainwebuk/payload-plugin-mcp-oauth'] = `file:${tgzPath}`
  // Drop workspace-coupled lifecycle scripts that assume the monorepo.
  delete pkg.scripts.prebuild
  delete pkg.scripts.postbuild
  // Allow native build scripts (sharp etc.) in the standalone install.
  pkg.pnpm = { ...(pkg.pnpm ?? {}), onlyBuiltDependencies: ['sharp', 'esbuild', 'unrs-resolver'] }
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2))

  const port = await freePort()
  const baseUrl = `http://localhost:${port}`
  // Plain `node`/`tsx` (unlike `next`) does not auto-load .env, so we both write
  // the file AND inject these into every spawned process explicitly.
  const appEnv = {
    PAYLOAD_SECRET: randomBytes(32).toString('hex'),
    DATABASE_URL: 'file:./install-test.db',
    NEXT_PUBLIC_SERVER_URL: baseUrl,
    PMOAUTH_TOKEN_PEPPER: randomBytes(32).toString('hex'),
  }
  writeFileSync(path.join(appDir, '.env'), Object.entries(appEnv).map(([k, v]) => `${k}=${v}`).join('\n') + '\n')

  await run('pnpm', ['install', '--ignore-workspace'], { cwd: appDir })
  check('install: clean pnpm install of the tarball succeeded', true)

  // 3. Packaging: the three published subpaths must resolve through the exports
  //    map to files that exist. We RESOLVE rather than import — /middleware and
  //    /admin pull in next/react, which only resolve inside the bundler, not
  //    under plain Node — so importing them here would be a false negative. We
  //    do import the server-only `.` entry to confirm it executes and exports.
  console.log('\n[3/7] Verifying published entry points resolve…')
  const probe = [
    "import { createRequire } from 'node:module'",
    'const require = createRequire(process.cwd() + "/package.json")',
    "const pkg = '@brainwebuk/payload-plugin-mcp-oauth'",
    "for (const sub of ['', '/middleware', '/admin']) require.resolve(pkg + sub)",
    "const m = await import(pkg)",
    "if (typeof m.payloadMcpOAuth !== 'function') throw new Error('missing payloadMcpOAuth export')",
  ].join(';')
  try {
    await run('node', ['--input-type=module', '-e', probe], { cwd: appDir })
    check('packaging: . , /middleware and /admin subpaths all resolve via exports map', true)
  } catch (err) {
    check('packaging: . , /middleware and /admin subpaths all resolve via exports map', false, String(err.message))
  }

  // 4. Import map: regenerate and assert the OAuth admin views got wired in.
  //    Invoke the installed binary directly (not `pnpm payload …`) so pnpm never
  //    re-resolves a project context that could rewrite the monorepo lockfile.
  console.log('\n[4/7] Regenerating the admin import map…')
  const payloadBin = path.join(appDir, 'node_modules/.bin/payload')
  await run(payloadBin, ['generate:importmap'], { cwd: appDir, env: { ...process.env, ...appEnv, NODE_OPTIONS: '--no-deprecation' } })
  const importMap = readFileSync(path.join(appDir, 'src/app/(payload)/admin/importMap.js'), 'utf8')
  check(
    'importmap: references the plugin admin views (TokensView/ClientsView)',
    importMap.includes('payload-plugin-mcp-oauth/admin') && /Tokens|Clients/i.test(importMap),
    'run `payload generate:importmap` — the oauth/tokens & oauth/clients views need it',
  )

  // 5. DB migrations: booting Payload pushes the schema; assert the plugin's
  //    three collections are queryable, and seed an admin for the handshake.
  console.log('\n[5/7] Booting Payload (schema push) + seeding admin…')
  const seedOut = await run('node', ['--import', 'tsx', 'install-seed.mjs'], {
    cwd: appDir,
    env: { ...process.env, ...appEnv, SEED_EMAIL: ADMIN.email, SEED_PASSWORD: ADMIN.password, NODE_ENV: 'development' },
  }).catch((e) => e.message)
  const seedLine = String(seedOut).split('\n').find((l) => l.includes('INSTALL_SEED_RESULT'))
  let seed = {}
  try {
    seed = JSON.parse(seedLine.replace('INSTALL_SEED_RESULT', '').trim())
  } catch {
    /* leave empty → fails below */
  }
  check(
    'migrations: oauth-clients / oauth-auth-codes / oauth-tokens are queryable',
    seed.ok === true && Object.values(seed.collections ?? {}).every(Boolean),
    seed.error ?? String(seedOut).slice(-2000),
  )

  // 6. Start the app and drive the full handshake.
  console.log('\n[6/7] Starting the app and running the OAuth + PKCE handshake…')
  const nextBin = path.join(appDir, 'node_modules/.bin/next')
  server = spawn(nextBin, ['dev', '-p', String(port)], {
    cwd: appDir,
    env: { ...process.env, ...appEnv, NODE_OPTIONS: '--no-deprecation' },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  })
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

  // 7. Production safety: no pepper must refuse to boot (env pain point).
  console.log('\n[7/7] Verifying production refuses to boot without a token pepper…')
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
  // Restore the repo lockfile if any pnpm invocation perturbed it.
  try {
    if (readFileSync(lockfilePath, 'utf8') !== lockfileSnapshot) {
      writeFileSync(lockfilePath, lockfileSnapshot)
      console.log('Note: restored repo pnpm-lock.yaml (a pnpm step had modified it).')
    }
  } catch {
    /* ignore */
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
