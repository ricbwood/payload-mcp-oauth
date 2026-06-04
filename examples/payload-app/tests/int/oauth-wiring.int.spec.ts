import { getPayload, type Payload } from 'payload'
import config from '@/payload.config'
import { beforeAll, describe, expect, it } from 'vitest'

// Integration test for the EXAMPLE APP's plugin wiring: boots Payload with
// payloadMcpOAuth() registered (via workspace source) and asserts the plugin's
// runtime effects — the OAuth collections + endpoints are registered and the
// schema is pushed. The full HTTP OAuth handshake against the published package
// is covered separately by `pnpm test:install`.

const OAUTH_COLLECTIONS = ['oauth-clients', 'oauth-auth-codes', 'oauth-tokens'] as const

let payload: Payload

beforeAll(async () => {
  payload = await getPayload({ config: await config })
})

describe('example app — payloadMcpOAuth wiring (integration)', () => {
  it('boots Payload with the OAuth plugin registered', () => {
    expect(payload).toBeDefined()
  })

  it('registers the three OAuth collections', () => {
    for (const slug of OAUTH_COLLECTIONS) {
      expect(payload.collections[slug], `collection ${slug} should be registered`).toBeDefined()
    }
  })

  it('pushed the OAuth collection schema (tables are queryable)', async () => {
    for (const slug of OAUTH_COLLECTIONS) {
      await expect(payload.count({ collection: slug }), `count(${slug}) should not throw`).resolves.toBeDefined()
    }
  })

  it('registers the OAuth + discovery endpoints', () => {
    const registered = (payload.config.endpoints ?? []).map((e) => `${String(e.method).toUpperCase()} ${e.path}`)
    const expected = [
      'GET /.well-known/oauth-authorization-server',
      'GET /.well-known/oauth-protected-resource',
      'POST /oauth/register',
      'GET /oauth/authorize',
      'POST /oauth/consent',
      'POST /oauth/token',
      'POST /oauth/revoke',
    ]
    for (const e of expected) expect(registered, `endpoint ${e}`).toContain(e)
  })

  it('preserves the base users collection', async () => {
    await expect(payload.find({ collection: 'users' })).resolves.toBeDefined()
  })
})
