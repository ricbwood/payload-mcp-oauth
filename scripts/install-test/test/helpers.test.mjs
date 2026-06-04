// Unit tests for the install-test tooling helpers, using Node's built-in test
// runner (no extra deps — scripts/install-test isn't a package). Run with:
//   node --test scripts/install-test/test/
// These guard the pure helpers behind the install harness (parsing, env I/O,
// source refresh) — the spots where regressions previously slipped in.

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { decodeEntities, parseConsentFields } from '../lib/handshake.mjs'
import { makeAppEnv, readEnv, refreshAppSource, writeEnv } from '../lib/provision.mjs'

test('decodeEntities decodes HTML entities and avoids double-unescaping', () => {
  assert.equal(decodeEntities('a&amp;b'), 'a&b')
  assert.equal(decodeEntities('&lt;tag&gt;'), '<tag>')
  assert.equal(decodeEntities('&quot;x&#x27;y'), '"x\'y')
  // `&amp;` is decoded LAST, so an already-escaped sequence stays literal:
  assert.equal(decodeEntities('&amp;lt;'), '&lt;')
})

test('parseConsentFields extracts hidden inputs and decodes their values', () => {
  const html = `
    <form method="POST" action="/api/oauth/consent">
      <input type="hidden" name="client_id" value="abc-123">
      <input type="hidden" name="redirect_uri" value="https://app.example/cb">
      <input type="hidden" name="csrf_token" value="deadbeef">
      <input type="hidden" name="scope" value="users:read &amp; media:read">
      <button type="submit" name="decision" value="approve">Approve</button>
    </form>`
  const f = parseConsentFields(html)
  assert.equal(f.client_id, 'abc-123')
  assert.equal(f.redirect_uri, 'https://app.example/cb')
  assert.equal(f.csrf_token, 'deadbeef')
  assert.equal(f.scope, 'users:read & media:read') // entity-decoded
  assert.equal(f.decision, undefined) // non-hidden inputs ignored
})

test('readEnv round-trips writeEnv, ignores comments/blanks, preserves "=" in values', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pmoauth-readenv-'))
  try {
    assert.deepEqual(readEnv(dir), {}) // no .env yet → {}
    const env = makeAppEnv('http://localhost:1234')
    writeEnv(dir, env)
    const back = readEnv(dir)
    assert.equal(back.PMOAUTH_TOKEN_PEPPER, env.PMOAUTH_TOKEN_PEPPER)
    assert.equal(back.DATABASE_URL, env.DATABASE_URL)
    assert.equal(back.NEXT_PUBLIC_SERVER_URL, 'http://localhost:1234')

    writeFileSync(path.join(dir, '.env'), '# a comment\n\nFOO=a=b=c\nBAR=baz\n')
    const r = readEnv(dir)
    assert.equal(r.FOO, 'a=b=c') // value with '=' preserved
    assert.equal(r.BAR, 'baz')
    assert.equal(r['# a comment'], undefined) // comment line ignored
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('refreshAppSource drops stale src files and preserves the install state', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'pmoauth-refresh-'))
  const app = path.join(root, 'app')
  try {
    mkdirSync(path.join(app, 'src'), { recursive: true })
    writeFileSync(path.join(app, 'src/middleware.ts'), 'STALE') // pre-migration file
    mkdirSync(path.join(app, 'node_modules/.bin'), { recursive: true })
    writeFileSync(path.join(app, 'node_modules/.bin/next'), '#!bin')
    writeFileSync(path.join(app, 'install-test.db'), 'DB')
    writeFileSync(path.join(app, 'package.json'), '{"custom":true}') // provision-customised
    writeFileSync(path.join(app, '.env'), 'PMOAUTH_TOKEN_PEPPER=keep')

    refreshAppSource(app)

    assert.equal(existsSync(path.join(app, 'src/middleware.ts')), false, 'stale middleware.ts removed')
    assert.equal(existsSync(path.join(app, 'src/proxy.ts')), true, 'current proxy.ts copied in')
    assert.equal(existsSync(path.join(app, 'src/payload.config.ts')), true, 'source refreshed')
    assert.equal(existsSync(path.join(app, 'node_modules/.bin/next')), true, 'node_modules preserved')
    assert.equal(existsSync(path.join(app, 'install-test.db')), true, 'DB preserved')
    assert.equal(readFileSync(path.join(app, 'package.json'), 'utf8'), '{"custom":true}', 'package.json preserved')
    assert.match(readFileSync(path.join(app, '.env'), 'utf8'), /keep/, '.env preserved')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
