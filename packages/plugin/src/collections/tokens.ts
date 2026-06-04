import type { Access, CollectionAfterChangeHook, CollectionConfig } from 'payload'

// Managed server-side only: the plugin endpoints use overrideAccess and the
// admin TokensView reads via the Local API with its own per-user scoping. Deny
// all public REST/GraphQL access — see clients.ts for the rationale (previously
// any authenticated user could read all tokens or revoke/forge others').
const denyPublicAccess: Access = () => false

const cascadeRevokeAccessTokens: CollectionAfterChangeHook = async ({
  doc,
  previousDoc,
  operation,
  req,
}) => {
  if (operation !== 'update') return
  // Only cascade when revokedAt is newly set on a refresh token
  if (!doc.revokedAt || previousDoc?.revokedAt) return
  if (doc.tokenType !== 'refresh') return

  const { docs: activeAccessTokens } = await req.payload.find({
    collection: 'oauth-tokens',
    where: {
      and: [
        { clientId: { equals: doc.clientId as string } },
        { userId: { equals: doc.userId as string } },
        { tokenType: { equals: 'access' } },
        { revokedAt: { equals: null } },
      ],
    },
    limit: 1000,
    pagination: false,
    req,
  })

  await Promise.all(
    activeAccessTokens.map((token) =>
      req.payload.update({
        collection: 'oauth-tokens',
        id: token.id,
        data: { revokedAt: new Date().toISOString() },
        req,
      }),
    ),
  )
}

export const oauthTokensCollection: CollectionConfig = {
  slug: 'oauth-tokens',
  admin: {
    hidden: true,
  },
  access: {
    create: denyPublicAccess,
    read: denyPublicAccess,
    update: denyPublicAccess,
    delete: denyPublicAccess,
  },
  timestamps: false,
  hooks: {
    afterChange: [cascadeRevokeAccessTokens],
  },
  fields: [
    {
      name: 'tokenHash',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      admin: {
        readOnly: true,
        description: 'HMAC-SHA-256 hash of the token plaintext. Never store plaintext.',
      },
    },
    {
      name: 'tokenType',
      type: 'select',
      required: true,
      index: true,
      admin: { readOnly: true },
      options: [
        { label: 'Access Token', value: 'access' },
        { label: 'Refresh Token', value: 'refresh' },
      ],
    },
    {
      name: 'clientId',
      type: 'text',
      required: true,
      index: true,
      admin: { readOnly: true },
    },
    {
      name: 'userId',
      type: 'text',
      required: true,
      index: true,
      admin: { readOnly: true },
    },
    {
      name: 'scope',
      type: 'text',
      admin: { readOnly: true },
    },
    {
      // Stores the MCPAccessSettings shape (minus user) so we can reconstruct
      // the full access settings at token validation time without a user lookup.
      name: 'capabilities',
      type: 'json',
      admin: {
        readOnly: true,
        description: 'MCPAccessSettings-compatible capability flags granted at consent.',
      },
    },
    {
      name: 'expiresAt',
      type: 'date',
      required: true,
      index: true,
      admin: { readOnly: true },
    },
    {
      name: 'revokedAt',
      type: 'date',
      index: true,
      admin: {
        readOnly: true,
        description: 'Set when the token is explicitly revoked or a refresh token family is invalidated.',
      },
    },
    {
      name: 'lastUsedAt',
      type: 'date',
      admin: {
        readOnly: true,
        description: 'Updated (best-effort) on each successful validation.',
      },
    },
    {
      name: 'parentTokenId',
      type: 'text',
      index: true,
      admin: {
        readOnly: true,
        description: 'ID of the refresh token this token replaced. Used to trace the rotation family.',
      },
    },
  ],
  labels: {
    singular: 'OAuth Token',
    plural: 'OAuth Tokens',
  },
}
