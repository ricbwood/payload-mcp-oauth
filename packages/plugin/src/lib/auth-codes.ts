import type { Payload } from 'payload'
import { verifyPkce } from './pkce.js'
import { generateToken } from './token-generation.js'
import { hashToken } from './token-storage.js'

export interface IssueAuthCodeParams {
  clientId: string
  userId: string
  redirectUri: string
  scope: string
  codeChallenge: string
  codeChallengeMethod: 'S256'
  ttlSeconds?: number
}

export interface AuthCodeContext {
  clientId: string
  userId: string
  redirectUri: string
  scope: string
}

export async function issueAuthCode(payload: Payload, params: IssueAuthCodeParams): Promise<string> {
  const { clientId, userId, redirectUri, scope, codeChallenge, codeChallengeMethod, ttlSeconds = 60 } = params

  const plaintext = generateToken('code')
  const codeHash = hashToken(plaintext)
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString()

  await payload.create({
    collection: 'oauth-auth-codes',
    data: { codeHash, clientId, userId, redirectUri, scope, codeChallenge, codeChallengeMethod, expiresAt },
  })

  return plaintext
}

export async function consumeAuthCode(
  payload: Payload,
  plaintext: string,
  params: { clientId: string; redirectUri: string; codeVerifier: string },
): Promise<AuthCodeContext | null> {
  const codeHash = hashToken(plaintext)

  const { docs } = await payload.find({
    collection: 'oauth-auth-codes',
    where: { codeHash: { equals: codeHash } },
    limit: 1,
    pagination: false,
  })

  const code = docs[0]
  if (!code) return null

  // Reject if already consumed — concurrent requests will see this set
  if (code['consumedAt']) return null

  // Reject if expired
  if (new Date(code['expiresAt'] as string) < new Date()) return null

  // Reject if client or redirect_uri mismatch
  if (code['clientId'] !== params.clientId) return null
  if (code['redirectUri'] !== params.redirectUri) return null

  // Reject if PKCE verification fails
  if (!verifyPkce(params.codeVerifier, code['codeChallenge'] as string, 'S256')) return null

  // Mark consumed — any subsequent request finding this code will see consumedAt set
  await payload.update({
    collection: 'oauth-auth-codes',
    id: code.id,
    data: { consumedAt: new Date().toISOString() },
  })

  return {
    clientId: code['clientId'] as string,
    userId: code['userId'] as string,
    redirectUri: code['redirectUri'] as string,
    scope: (code['scope'] as string | null | undefined) ?? '',
  }
}
