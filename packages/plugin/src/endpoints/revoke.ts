import type { PayloadHandler } from 'payload'
import { hashToken } from '../lib/token-storage.js'
import { jsonResponse, parseBody } from './helpers.js'

export function makeRevokeHandler(): PayloadHandler {
  return async (req) => {
    // RFC 7009 §2.1: always 200, even on method mismatch, to avoid info leakage
    if (req.method !== 'POST') {
      return jsonResponse({})
    }

    const body = await parseBody(req)
    const token = body['token'] as string | undefined
    const clientId = body['client_id'] as string | undefined

    if (!token || typeof token !== 'string') {
      return jsonResponse({})
    }

    const hash = hashToken(token)

    const { docs } = await req.payload.find({
      collection: 'oauth-tokens',
      where: { tokenHash: { equals: hash } },
      limit: 1,
    })

    const doc = docs[0]
    if (!doc) {
      return jsonResponse({})
    }

    if (clientId && doc['clientId'] !== clientId) {
      return jsonResponse({})
    }

    if (doc['revokedAt']) {
      return jsonResponse({})
    }

    const now = new Date().toISOString()
    await req.payload.update({
      collection: 'oauth-tokens',
      id: String(doc['id']),
      data: { revokedAt: now },
    })

    if (doc['tokenType'] === 'refresh') {
      const { docs: accessDocs } = await req.payload.find({
        collection: 'oauth-tokens',
        where: {
          parentTokenId: { equals: String(doc['id']) },
          revokedAt: { equals: null },
        },
        limit: 100,
      })
      await Promise.all(
        accessDocs.map((ad) =>
          req.payload.update({
            collection: 'oauth-tokens',
            id: String(ad['id']),
            data: { revokedAt: now },
          }),
        ),
      )
    }

    return jsonResponse({})
  }
}
