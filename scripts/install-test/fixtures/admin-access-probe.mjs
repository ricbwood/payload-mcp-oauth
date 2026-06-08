// Runs INSIDE the freshly-installed temp app (executed with tsx, cwd = appDir, so
// `@brainwebuk/payload-plugin-mcp-oauth` resolves to the installed tarball — the
// real published artifact, not repo source).
//
// Proves the security boundary the README and clients.ts call out: a CUSTOM
// `adminAccess` rule must gate the OAuth collections to genuine admins, not to
// "any authenticated user". The gate is the difference between an editor being
// able to rewrite a client's redirectUris (→ auth-code theft) and not. The HTTP
// admin checks in run.mjs only cover the DEFAULT gate (collection-membership);
// here we wire a role-based rule and assert allow/deny at the Local API level.
//
// Builds its own minimal config (so the reference example app keeps its no-role
// Users collection) with a `role` field + adminAccess = role==='admin', seeds an
// admin and a non-admin, and checks read access on oauth-clients for each.
//
// Prints a single line `ADMIN_ACCESS_RESULT <json>` that the orchestrator parses.

import { buildConfig, getPayload } from 'payload'
import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { mcpPlugin } from '@payloadcms/plugin-mcp'
import { payloadMcpOAuth } from '@brainwebuk/payload-plugin-mcp-oauth'

const result = { ok: false, adminAllowed: null, nonAdminDenied: null, error: null }

/** True if read on the collection is ALLOWED for `user` (no Forbidden thrown). */
async function canRead(payload, user) {
  try {
    await payload.find({ collection: 'oauth-clients', user, overrideAccess: false, limit: 0, depth: 0 })
    return true
  } catch {
    return false
  }
}

try {
  const mcpOptions = { collections: { users: { enabled: { find: true } } } }
  const config = buildConfig({
    secret: process.env.PAYLOAD_SECRET,
    db: sqliteAdapter({ client: { url: process.env.DATABASE_URL } }),
    collections: [
      {
        slug: 'users',
        auth: true,
        fields: [
          { name: 'role', type: 'select', options: ['admin', 'editor'], defaultValue: 'editor', required: true },
        ],
      },
    ],
    plugins: [
      mcpPlugin(mcpOptions),
      payloadMcpOAuth({
        issuer: 'http://localhost',
        mcpPluginOptions: mcpOptions,
        // The case under test: a non-default, role-based admin gate.
        adminAccess: ({ req }) => req.user?.role === 'admin',
      }),
    ],
  })

  const payload = await getPayload({ config })
  const admin = await payload.create({ collection: 'users', data: { email: 'admin@probe.test', password: 'probe-pw-123', role: 'admin' } })
  const editor = await payload.create({ collection: 'users', data: { email: 'editor@probe.test', password: 'probe-pw-123', role: 'editor' } })

  result.adminAllowed = await canRead(payload, admin)
  result.nonAdminDenied = !(await canRead(payload, editor))
  result.ok = result.adminAllowed === true && result.nonAdminDenied === true
} catch (err) {
  result.error = String(err?.stack ?? err)
}

console.log(`ADMIN_ACCESS_RESULT ${JSON.stringify(result)}`)
process.exit(result.ok ? 0 : 1)
