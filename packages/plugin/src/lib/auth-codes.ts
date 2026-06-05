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
    overrideAccess: true,
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

  // Pre-filter: only fetch codes that are still valid (not consumed, not expired).
  // This reduces the window for validation failures and improves DB efficiency.
  const { docs } = await payload.find({
    collection: 'oauth-auth-codes',
    overrideAccess: true,
    where: {
      and: [
        { codeHash: { equals: codeHash } },
        { consumedAt: { equals: null } },
        { expiresAt: { greater_than: new Date().toISOString() } },
      ],
    },
    limit: 1,
    pagination: false,
  })

  const code = docs[0]
  if (!code) return null

  // Validate request-supplied fields against the stored code
  if (code['clientId'] !== params.clientId) return null
  if (code['redirectUri'] !== params.redirectUri) return null
  if (!verifyPkce(params.codeVerifier, code['codeChallenge'] as string, 'S256')) return null

  // Atomic conditional update: only marks consumed if consumedAt is still null.
  // Two concurrent requests with the same code will both pass the find+validate
  // above, but only one can win this UPDATE WHERE consumedAt IS NULL — the DB
  // serialises the writes and the loser gets back an empty docs array.
  const result = await payload.update({
    collection: 'oauth-auth-codes',
    overrideAccess: true,
    where: {
      and: [
        { codeHash: { equals: codeHash } },
        { consumedAt: { equals: null } },
      ],
    },
    data: { consumedAt: new Date().toISOString() },
  })

  // Cast: payload.update with `where` returns BulkOperationResult { docs, errors }
  const consumed = (result as unknown as { docs: unknown[] }).docs
  if (!consumed?.length) return null

  return {
    clientId: code['clientId'] as string,
    userId: code['userId'] as string,
    redirectUri: code['redirectUri'] as string,
    scope: (code['scope'] as string | null | undefined) ?? '',
  }
}
