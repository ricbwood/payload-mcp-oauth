#!/usr/bin/env node
// Stand up the freshly-installed test site and leave it running so you can open
// it in a browser. Same install path as `pnpm test:install` (it shares
// ./lib/provision.mjs), but instead of running the OAuth handshake it boots
// `next dev` in the foreground and prints the URL + admin login.
//
// Usage:  pnpm test:install:serve            # http://localhost:3000
//         pnpm test:install:serve -- --port 4000
//         pnpm test:install:serve -- --fresh # rebuild from scratch (else reuse)
//
// The app lives at <tmp>/pmoauth-serve/app and is reused across launches for
// speed; --fresh wipes and reprovisions it. Press Ctrl+C to stop.

import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  ADMIN,
  LOCKFILE,
  freePort,
  isProvisioned,
  makeAppEnv,
  portFree,
  provisionApp,
  readEnv,
  restoreLockfile,
  seedAndMigrate,
  startDevServer,
  waitForServer,
  writeEnv,
} from './lib/provision.mjs'

function argValue(name, fallback) {
  const i = process.argv.indexOf(name)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const FRESH = process.argv.includes('--fresh')
const wantedPort = Number(argValue('--port', '3000'))

const appDir = path.join(tmpdir(), 'pmoauth-serve', 'app')
const lockfileSnapshot = readFileSync(LOCKFILE, 'utf8')

let server
let shuttingDown = false
function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  if (server) {
    try {
      // startDevServer runs detached, so kill the whole process group.
      process.kill(-server.pid, 'SIGKILL')
    } catch {
      /* already gone */
    }
  }
  if (restoreLockfile(lockfileSnapshot)) {
    console.log('\nRestored repo pnpm-lock.yaml.')
  }
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

try {
  const port = (await portFree(wantedPort)) ? wantedPort : await freePort()
  if (port !== wantedPort) console.log(`Port ${wantedPort} is busy → using ${port} instead.`)
  const baseUrl = `http://localhost:${port}`

  let appEnv
  if (FRESH || !isProvisioned(appDir)) {
    rmSync(path.dirname(appDir), { recursive: true, force: true })
    mkdirSync(appDir, { recursive: true })
    console.log('Provisioning the test site from the packed plugin (first run is slow — a full install + cold compile)…\n')
    ;({ appEnv } = await provisionApp({ appDir, port, log: (m) => console.log(`   • ${m}`) }))
  } else {
    console.log(`Reusing the existing install at ${appDir} (pass --fresh to rebuild).`)
    // Reuse the env from the prior provision so PMOAUTH_TOKEN_PEPPER / PAYLOAD_SECRET
    // stay stable across launches — otherwise OAuth tokens already stored in the
    // persisted DB (hashed with the old pepper) would stop validating. Only the
    // public server URL changes, to match the (possibly new) port.
    const prior = readEnv(appDir)
    appEnv = prior.PMOAUTH_TOKEN_PEPPER ? { ...prior, NEXT_PUBLIC_SERVER_URL: baseUrl } : makeAppEnv(baseUrl)
    writeEnv(appDir, appEnv)
    await seedAndMigrate(appDir, appEnv)
  }

  // Provisioning is the only thing that can perturb the repo lockfile; the dev
  // server (direct next binary) never touches it. Restore now so the repo is
  // clean for the whole time the server runs, even if it's later SIGKILL'd.
  if (restoreLockfile(lockfileSnapshot)) console.log('Restored repo pnpm-lock.yaml (a pnpm step had modified it).')

  console.log('\nStarting next dev…\n')
  server = startDevServer({ appDir, port, appEnv, inheritStdio: false })
  // Stream next dev's output live (so the slow first compile isn't a silent
  // wait) while still buffering the tail for the crash dump below.
  let log = ''
  server.stdout.on('data', (d) => {
    log += d
    process.stdout.write(d)
  })
  server.stderr.on('data', (d) => {
    log += d
    process.stderr.write(d)
  })
  server.on('close', () => {
    if (!shuttingDown) {
      console.error(`\nnext dev exited unexpectedly:\n${log.slice(-2000)}`)
      shutdown()
    }
  })

  await waitForServer(`${baseUrl}/admin`, 180_000, server)

  console.log(`
────────────────────────────────────────────────────────────
  ✅  Test Payload site is up — installed from the packed plugin.

  Admin panel : ${baseUrl}/admin
      sign in : ${ADMIN.email}  /  ${ADMIN.password}

  Plugin admin views:
      tokens  : ${baseUrl}/admin/collections/oauth-tokens
      clients : ${baseUrl}/admin/collections/oauth-clients

  OAuth discovery (served via the middleware):
      ${baseUrl}/.well-known/oauth-authorization-server
      ${baseUrl}/.well-known/oauth-protected-resource

  App location: ${appDir}
  Press Ctrl+C to stop.
────────────────────────────────────────────────────────────
`)
  // Idle until Ctrl+C; the detached dev server keeps serving.
} catch (err) {
  console.error(`\nFailed to start the test site: ${err.stack ?? err}`)
  shutdown()
}
