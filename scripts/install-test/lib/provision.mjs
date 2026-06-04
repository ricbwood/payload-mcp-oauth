// Shared provisioning for the install test and the `serve` command, so the site
// you can click around in (`serve`) is provisioned the exact same way the test
// validates. Both call provisionApp(); they only differ in what they do after:
// the test drives the OAuth handshake, serve leaves `next dev` running.

import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:net'
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url)) // scripts/install-test/lib
export const INSTALL_ROOT = path.resolve(here, '..') // scripts/install-test
export const REPO_ROOT = path.resolve(here, '../../..') // repo root
export const LOCKFILE = path.join(REPO_ROOT, 'pnpm-lock.yaml')
export const ADMIN = { email: 'install-test@example.com', password: 'install-test-password-123' }

const pluginDir = path.join(REPO_ROOT, 'packages/plugin')
const exampleApp = path.join(REPO_ROOT, 'examples/payload-app')
const EXCLUDE = new Set(['node_modules', '.next', 'dist', 'playwright-report', 'test-results', 'dev.db', 'payload.db'])

/** Run a command to completion; resolve with combined output, reject on non-zero. */
export function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts })
    let out = ''
    child.stdout?.on('data', (d) => (out += d))
    child.stderr?.on('data', (d) => (out += d))
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} ${args.join(' ')} exited ${code}\n${out.slice(-4000)}`))))
  })
}

export function freePort() {
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

/** Resolve to true if nothing is already listening on `port`. */
export function portFree(port) {
  return new Promise((resolve) => {
    const srv = createServer()
    srv.once('error', () => resolve(false))
    srv.once('listening', () => srv.close(() => resolve(true)))
    srv.listen(port)
  })
}

export async function waitForServer(url, timeoutMs, child) {
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

export function makeAppEnv(baseUrl) {
  return {
    PAYLOAD_SECRET: randomBytes(32).toString('hex'),
    DATABASE_URL: 'file:./install-test.db',
    NEXT_PUBLIC_SERVER_URL: baseUrl,
    PMOAUTH_TOKEN_PEPPER: randomBytes(32).toString('hex'),
  }
}

export function writeEnv(appDir, appEnv) {
  writeFileSync(path.join(appDir, '.env'), Object.entries(appEnv).map(([k, v]) => `${k}=${v}`).join('\n') + '\n')
}

/** Parse an app's .env back into an object (best-effort; returns {} if absent). */
export function readEnv(appDir) {
  try {
    const raw = readFileSync(path.join(appDir, '.env'), 'utf8')
    return Object.fromEntries(
      raw
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#') && l.includes('='))
        .map((l) => {
          const i = l.indexOf('=')
          return [l.slice(0, i), l.slice(i + 1)]
        }),
    )
  } catch {
    return {}
  }
}

/** Boot Payload via the in-app seed fixture: pushes the schema and seeds the admin. */
export async function seedAndMigrate(appDir, appEnv) {
  const out = await run('node', ['--import', 'tsx', 'install-seed.mjs'], {
    cwd: appDir,
    env: { ...process.env, ...appEnv, SEED_EMAIL: ADMIN.email, SEED_PASSWORD: ADMIN.password, NODE_ENV: 'development' },
  }).catch((e) => e.message)
  const line = String(out).split('\n').find((l) => l.includes('INSTALL_SEED_RESULT'))
  try {
    return { ...JSON.parse(line.replace('INSTALL_SEED_RESULT', '').trim()), raw: out }
  } catch {
    return { ok: false, collections: {}, raw: out }
  }
}

/** Spawn `next dev`. Test mode pipes+detaches (for capture/kill); serve inherits stdio. */
export function startDevServer({ appDir, port, appEnv, inheritStdio = false }) {
  const nextBin = path.join(appDir, 'node_modules/.bin/next')
  return spawn(nextBin, ['dev', '-p', String(port)], {
    cwd: appDir,
    env: { ...process.env, ...appEnv, NODE_OPTIONS: '--no-deprecation' },
    stdio: inheritStdio ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    detached: !inheritStdio,
  })
}

export function isProvisioned(appDir) {
  return existsSync(path.join(appDir, 'node_modules/.bin/next'))
}

/** Restore the repo lockfile from a snapshot if a pnpm step perturbed it. Returns true if restored. */
export function restoreLockfile(snapshot) {
  try {
    if (readFileSync(LOCKFILE, 'utf8') !== snapshot) {
      writeFileSync(LOCKFILE, snapshot)
      return true
    }
  } catch {
    /* ignore */
  }
  return false
}

/**
 * Full provisioning: build + `pnpm pack` the plugin, copy the example app into
 * `appDir`, repoint the dependency to the tarball, clean-install, regenerate the
 * import map, push the schema and seed the admin. Returns the bits both callers
 * need. Throws on any hard failure.
 */
export async function provisionApp({ appDir, port, log = () => {} }) {
  const baseUrl = `http://localhost:${port}`
  const appEnv = makeAppEnv(baseUrl)

  log('Building and packing the plugin…')
  await run('pnpm', ['--filter', '@brainwebuk/payload-plugin-mcp-oauth', 'build'], { cwd: REPO_ROOT })
  const packDest = path.dirname(appDir)
  const packOut = await run('pnpm', ['pack', '--pack-destination', packDest], { cwd: pluginDir })
  const tgzName = packOut.trim().split('\n').map((l) => l.trim()).reverse().find((l) => l.endsWith('.tgz'))
  if (!tgzName) throw new Error(`could not find .tgz in pnpm pack output:\n${packOut}`)
  const tgzPath = path.isAbsolute(tgzName) ? tgzName : path.join(packDest, path.basename(tgzName))

  log('Copying the example app and repointing the dependency to the tarball…')
  mkdirSync(appDir, { recursive: true })
  cpSync(exampleApp, appDir, {
    recursive: true,
    filter: (src) => !EXCLUDE.has(path.basename(src)) && !path.basename(src).endsWith('.db'),
  })
  // Copy the in-app seed fixture next to package.json so tsx can import the config.
  cpSync(path.join(INSTALL_ROOT, 'fixtures/install-seed.mjs'), path.join(appDir, 'install-seed.mjs'))

  const pkgPath = path.join(appDir, 'package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  pkg.dependencies['@brainwebuk/payload-plugin-mcp-oauth'] = `file:${tgzPath}`
  // Drop workspace-coupled lifecycle scripts that assume the monorepo.
  delete pkg.scripts.prebuild
  delete pkg.scripts.postbuild
  // Allow native build scripts (sharp etc.) in the standalone install.
  pkg.pnpm = { ...(pkg.pnpm ?? {}), onlyBuiltDependencies: ['sharp', 'esbuild', 'unrs-resolver'] }
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2))

  writeEnv(appDir, appEnv)

  // The monorepo runs with strict-peer-dependencies=true and silences the
  // upstream `mcp-handler → @modelcontextprotocol/sdk` version mismatch via
  // peerDependencyRules. The isolated temp app doesn't inherit those rules, so
  // a strict global config (the repo's, or the user's ~/.npmrc) would hard-fail
  // the install on that harmless mismatch. Force non-strict here — both via the
  // project .npmrc (beats ~/.npmrc) and the CLI flag (beats everything) — so the
  // install is deterministic regardless of the host's pnpm config.
  writeFileSync(path.join(appDir, '.npmrc'), '\nstrict-peer-dependencies=false\n', { flag: 'a' })

  log('Installing (clean) from the packed tarball…')
  await run('pnpm', ['install', '--ignore-workspace', '--config.strict-peer-dependencies=false'], { cwd: appDir })

  log('Regenerating the admin import map…')
  const payloadBin = path.join(appDir, 'node_modules/.bin/payload')
  await run(payloadBin, ['generate:importmap'], { cwd: appDir, env: { ...process.env, ...appEnv, NODE_OPTIONS: '--no-deprecation' } })
  const importMapContent = readFileSync(path.join(appDir, 'src/app/(payload)/admin/importMap.js'), 'utf8')

  log('Booting Payload (schema push) + seeding admin…')
  const seedResult = await seedAndMigrate(appDir, appEnv)

  return { baseUrl, appEnv, tgzPath, importMapContent, seedResult }
}
