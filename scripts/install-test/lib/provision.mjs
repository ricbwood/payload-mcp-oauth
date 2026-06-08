// Shared provisioning for the install test and the `serve` command, so the site
// you can click around in (`serve`) is provisioned the exact same way the test
// validates. Both call provisionApp(); they only differ in what they do after:
// the test drives the OAuth handshake, serve leaves `next dev` running.

import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:net'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url)) // scripts/install-test/lib
export const INSTALL_ROOT = path.resolve(here, '..') // scripts/install-test
export const REPO_ROOT = path.resolve(here, '../../..') // repo root
export const LOCKFILE = path.join(REPO_ROOT, 'pnpm-lock.yaml')
export const ADMIN = { email: 'install-test@example.com', password: 'install-test-password-123' }

const pluginDir = path.join(REPO_ROOT, 'packages/plugin')
const exampleApp = path.join(REPO_ROOT, 'examples/payload-app')
// Also exclude pnpm-lock.yaml: the temp app repoints the plugin dep to the packed
// tarball (the example's committed lockfile pins it as workspace:*), so the temp
// app must resolve fresh against its customised package.json — a copied lockfile
// would mismatch (and, under CI's frozen-by-default install, hard-fail).
const EXCLUDE = new Set(['node_modules', '.next', 'dist', 'playwright-report', 'test-results', 'dev.db', 'payload.db', 'pnpm-lock.yaml'])

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

/**
 * Run `payload generate:importmap`, defended against an intermittent hang where
 * the step wedges at 0% CPU on loaded machines (the underlying getPayload boot
 * blocks and never returns). Each attempt is detached so we can SIGKILL the whole
 * group on timeout; a wedge is killed and retried rather than hanging the whole
 * provision forever. Throws (with the captured output) if it errors outright, or
 * if every attempt wedges.
 */
async function runImportMap({ appDir, appEnv, log, attempts = 3, timeoutMs = 120_000 }) {
  const payloadBin = path.join(appDir, 'node_modules/.bin/payload')
  let lastOut = ''
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const child = spawn(payloadBin, ['generate:importmap'], {
      cwd: appDir,
      env: { ...process.env, ...appEnv, NODE_OPTIONS: '--no-deprecation' },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    })
    let out = ''
    child.stdout?.on('data', (d) => (out += d))
    child.stderr?.on('data', (d) => (out += d))
    const result = await new Promise((resolve) => {
      const timer = setTimeout(() => {
        try {
          process.kill(-child.pid, 'SIGKILL')
        } catch {
          /* already gone */
        }
        resolve({ ok: false, timedOut: true })
      }, timeoutMs)
      child.on('error', (err) => (clearTimeout(timer), resolve({ ok: false, err })))
      child.on('close', (code) => (clearTimeout(timer), resolve({ ok: code === 0, code })))
    })
    lastOut = out
    if (result.ok) return
    if (result.timedOut) {
      log(`generate:importmap wedged (attempt ${attempt}/${attempts}) — killed after ${timeoutMs / 1000}s, retrying…`)
      continue
    }
    // A real (non-hang) failure won't fix itself on retry — fail fast.
    throw new Error(`generate:importmap failed: ${result.err?.message ?? `exit ${result.code}`}\n${out.slice(-2000)}`)
  }
  throw new Error(`generate:importmap wedged on all ${attempts} attempts (the known importmap hang on loaded machines).\n${lastOut.slice(-2000)}`)
}

/**
 * Try to bind `port` (0 = let the OS pick a free one). Resolves the bound port
 * number on success, or null if the port is already in use.
 */
function probePort(port) {
  return new Promise((resolve) => {
    const srv = createServer()
    srv.unref()
    // listen failed (e.g. EADDRINUSE) → port not free. The server never opened,
    // so there's nothing to close.
    const onListenError = () => resolve(null)
    srv.once('error', onListenError)
    srv.once('listening', () => {
      const { port: bound } = srv.address()
      // Listen succeeded: stop treating errors as "busy", and swallow any error
      // emitted during the async close so it can't resolve(null) or throw.
      srv.removeListener('error', onListenError)
      srv.on('error', () => {})
      srv.close(() => resolve(bound))
    })
    srv.listen(port)
  })
}

/** An OS-assigned free port. */
export async function freePort() {
  const port = await probePort(0)
  if (port == null) throw new Error('could not acquire a free port')
  return port
}

/** Resolve to true if nothing is already listening on `port`. */
export async function portFree(port) {
  return (await probePort(port)) !== null
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

/**
 * Start a Cloudflare quick tunnel (ephemeral `*.trycloudflare.com`, no login) that
 * forwards to `http://localhost:<port>`. Resolves once cloudflared prints its
 * public URL. Returns `{ proc, url }`; the caller owns the process lifecycle and
 * must kill the group (it's detached) on shutdown. Rejects with a helpful message
 * if cloudflared isn't installed or never produces a URL.
 */
export function startCloudflaredTunnel({ port, log = () => {}, timeoutMs = 30_000 }) {
  return new Promise((resolve, reject) => {
    const proc = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${port}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    })
    let buf = ''
    let settled = false
    const urlRe = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i
    const finish = (fn, arg) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn(arg)
    }
    // cloudflared logs the assigned URL to stderr; watch both streams to be safe.
    // cloudflared keeps logging after the URL appears, so bail once settled to
    // avoid re-matching the (still-buffered) URL on every subsequent chunk.
    const onData = (d) => {
      if (settled) return
      buf += d
      const m = buf.match(urlRe)
      if (m) {
        log(`tunnel up: ${m[0]}`)
        finish(resolve, { proc, url: m[0] })
      }
    }
    proc.stdout.on('data', onData)
    proc.stderr.on('data', onData)
    proc.on('error', (err) =>
      finish(
        reject,
        err.code === 'ENOENT'
          ? new Error('cloudflared is not installed or not on PATH — install it (`brew install cloudflared`) to use --live')
          : err,
      ),
    )
    proc.on('close', (code) => finish(reject, new Error(`cloudflared exited (${code}) before printing a URL:\n${buf.slice(-1000)}`)))
    const timer = setTimeout(() => {
      try {
        process.kill(-proc.pid, 'SIGKILL')
      } catch {
        /* already gone */
      }
      finish(reject, new Error(`cloudflared did not produce a URL within ${timeoutMs}ms:\n${buf.slice(-1000)}`))
    }, timeoutMs)
  })
}

/**
 * Re-copy the example app's `src/` into an existing install so a reused install
 * reflects the CURRENT repo source — picking up added/changed files and dropping
 * removed ones (e.g. the middleware.ts → proxy.ts migration). Deletes + recopies
 * `src/` (which holds proxy.ts, payload.config.ts, collections, the committed
 * importMap, etc.) while leaving node_modules, the DB, and the
 * provision-customised package.json/.env/.npmrc untouched. Heavy/structural
 * changes (deps, configs) still need a `--fresh` reprovision.
 */
export function refreshAppSource(appDir) {
  const dest = path.join(appDir, 'src')
  rmSync(dest, { recursive: true, force: true })
  cpSync(path.join(exampleApp, 'src'), dest, {
    recursive: true,
    filter: (s) => !path.basename(s).endsWith('.db'),
  })
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
export async function provisionApp({ appDir, port, publicUrl, log = () => {} }) {
  const baseUrl = `http://localhost:${port}`
  // The app binds localhost:port, but its OAuth issuer (+ Payload serverURL) is
  // `publicUrl` when given — e.g. the --live tunnel URL — so discovery metadata and
  // the consent origin are the public host, not localhost. Defaults to baseUrl.
  const appEnv = makeAppEnv(publicUrl ?? baseUrl)

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
  // Copy the in-app fixtures next to package.json so tsx can run them with the
  // temp app's node_modules (the installed tarball) on the resolution path.
  cpSync(path.join(INSTALL_ROOT, 'fixtures/install-seed.mjs'), path.join(appDir, 'install-seed.mjs'))
  cpSync(path.join(INSTALL_ROOT, 'fixtures/admin-access-probe.mjs'), path.join(appDir, 'admin-access-probe.mjs'))

  const pkgPath = path.join(appDir, 'package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  pkg.dependencies['@brainwebuk/payload-plugin-mcp-oauth'] = `file:${tgzPath}`
  // Drop workspace-coupled lifecycle scripts that assume the monorepo.
  delete pkg.scripts.prebuild
  delete pkg.scripts.postbuild
  // Allow native build scripts (sharp etc.) in the standalone install, and carry
  // the SAME peerDependencyRules a real consumer is told to use (INSTALL_FOR_AGENTS
  // Step 1) so the documented remedy for the upstream
  // `mcp-handler → @modelcontextprotocol/sdk` mismatch is exercised.
  pkg.pnpm = {
    ...(pkg.pnpm ?? {}),
    onlyBuiltDependencies: ['sharp', 'esbuild', 'unrs-resolver'],
    peerDependencyRules: {
      ignoreMissing: ['monaco-editor', 'yjs'],
      allowedVersions: { 'mcp-handler>@modelcontextprotocol/sdk': '*' },
    },
  }
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2))

  writeEnv(appDir, appEnv)

  // Set strict-peer-dependencies=false deterministically, regardless of the host's
  // pnpm config. pnpm's own default is non-strict (what most consumers get), so a
  // clean install must succeed here. We deliberately do NOT force strict ON: pnpm
  // 9.15 (the repo's pinned pnpm, used in CI) enforces strict inconsistently with
  // pnpm 10 and exits 1 even with the peerDependencyRules applied — so forcing
  // strict made the test pnpm-version-fragile. The rules above remain present so
  // the documented remedy is still exercised.
  writeFileSync(path.join(appDir, '.npmrc'), '\nstrict-peer-dependencies=false\n', { flag: 'a' })

  log('Installing (clean) from the packed tarball…')
  // --no-frozen-lockfile: the temp app has no lockfile (excluded above) and a
  // freshly-generated package.json, so it must resolve from scratch. CI sets
  // CI=true, which otherwise makes pnpm default to a frozen install and fail.
  await run('pnpm', ['install', '--ignore-workspace', '--no-frozen-lockfile', '--config.strict-peer-dependencies=false'], { cwd: appDir })

  log('Regenerating the admin import map…')
  await runImportMap({ appDir, appEnv, log })
  const importMapContent = readFileSync(path.join(appDir, 'src/app/(payload)/admin/importMap.js'), 'utf8')

  log('Booting Payload (schema push) + seeding admin…')
  const seedResult = await seedAndMigrate(appDir, appEnv)

  return { baseUrl, appEnv, tgzPath, importMapContent, seedResult }
}
