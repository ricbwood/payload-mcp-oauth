import type { Payload } from 'payload'
import { hashToken } from './token-storage.js'

export interface TokenContext {
  tokenId: string
  userId: string
  clientId: string
  scope: string
  capabilities: Record<string, unknown>
}

const CLOCK_SKEW_MS = 30_000

export async function validateAccessToken(
  payload: Payload,
  plaintext: string,
): Promise<TokenContext | null> {
  if (!plaintext.startsWith('pmoauth_at_')) return null

  const tokenHash = hashToken(plaintext)

  const { docs } = await payload.find({
    collection: 'oauth-tokens',
    where: {
      and: [
        { tokenHash: { equals: tokenHash } },
        { tokenType: { equals: 'access' } },
      ],
    },
    limit: 1,
    pagination: false,
  })

  const token = docs[0]
  if (!token) return null
  if (token['revokedAt']) return null
  if (new Date(token['expiresAt'] as string).getTime() + CLOCK_SKEW_MS < Date.now()) return null

  // Best-effort non-blocking lastUsedAt update — never let this delay the response
  payload
    .update({
      collection: 'oauth-tokens',
      id: token.id,
      data: { lastUsedAt: new Date().toISOString() },
    })
    .catch(() => undefined)

  return {
    tokenId: String(token.id),
    userId: token['userId'] as string,
    clientId: token['clientId'] as string,
    scope: (token['scope'] as string | null | undefined) ?? '',
    capabilities: (token['capabilities'] as Record<string, unknown> | null | undefined) ?? {},
  }
}
