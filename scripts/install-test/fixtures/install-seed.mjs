// Runs INSIDE the freshly-installed temp app (executed with tsx so it can import
// the TypeScript payload.config). Two jobs:
//   1. Boot Payload via getPayload — this drives the SQLite schema push, which is
//      where the plugin's three collections (oauth-clients/-auth-codes/-tokens)
//      get created. If migrations/schema for those tables fail, this throws.
//   2. Assert each OAuth collection is queryable, then seed an admin user the
//      HTTP handshake can log in as.
//
// Prints a single line `INSTALL_SEED_RESULT <json>` that the orchestrator parses.

import { getPayload } from 'payload'
import config from './src/payload.config.ts'

const email = process.env.SEED_EMAIL
const password = process.env.SEED_PASSWORD

const result = { ok: false, collections: {}, seeded: false, error: null }

try {
  const payload = await getPayload({ config })

  // Migrations / schema-push proof: every OAuth collection must be queryable.
  for (const slug of ['oauth-clients', 'oauth-auth-codes', 'oauth-tokens']) {
    try {
      await payload.count({ collection: slug })
      result.collections[slug] = true
    } catch (err) {
      result.collections[slug] = false
      result.error = `collection ${slug} not queryable: ${String(err?.message ?? err)}`
    }
  }

  // Seed (or reset) the admin user the handshake logs in as.
  const existing = await payload.find({ collection: 'users', where: { email: { equals: email } }, limit: 1 })
  if (existing.docs.length > 0) {
    await payload.update({ collection: 'users', id: existing.docs[0].id, data: { password } })
  } else {
    await payload.create({ collection: 'users', data: { email, password } })
  }
  result.seeded = true
  result.ok = Object.values(result.collections).every(Boolean)
} catch (err) {
  result.error = String(err?.stack ?? err)
}

console.log(`INSTALL_SEED_RESULT ${JSON.stringify(result)}`)
process.exit(result.ok ? 0 : 1)
