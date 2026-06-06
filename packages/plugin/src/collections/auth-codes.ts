import type { Access, CollectionAfterChangeHook, CollectionConfig } from 'payload'

// Managed server-side only (plugin endpoints use overrideAccess; no admin view
// reads this). Deny all public REST/GraphQL access — see clients.ts for the
// rationale (previously any authenticated user could read/tamper these rows).
const denyPublicAccess: Access = () => false

const sweepExpiredCodes: CollectionAfterChangeHook = async ({ operation, req }) => {
  if (operation !== 'create') return

  const now = new Date().toISOString()

  const expired = await req.payload.find({
    collection: 'oauth-auth-codes',
    overrideAccess: true,
    where: { expiresAt: { less_than: now } },
    limit: 200,
    pagination: false,
    req,
  })

  const consumed = await req.payload.find({
    collection: 'oauth-auth-codes',
    overrideAccess: true,
    where: { consumedAt: { exists: true } },
    limit: 200,
    pagination: false,
    req,
  })

  const toDelete = [
    ...new Set([
      ...expired.docs.map((d) => d.id),
      ...consumed.docs.map((d) => d.id),
    ]),
  ]

  await Promise.all(
    toDelete.map((id) =>
      req.payload
        .delete({ collection: 'oauth-auth-codes', overrideAccess: true, id, req })
        .catch((err) => {
          req.payload.logger?.warn(`[pmoauth] sweepExpiredCodes: failed to delete id=${id}: ${String(err)}`)
        }),
    ),
  )
}

export const oauthAuthCodesCollection: CollectionConfig = {
  slug: 'oauth-auth-codes',
  // Server-managed — opt out of document-locking so no FK column is added to
  // payload_locked_documents_rels (avoids the SQLite push rebuild bug; see clients.ts).
  lockDocuments: false,
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
    afterChange: [sweepExpiredCodes],
  },
  fields: [
    {
      name: 'codeHash',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      admin: {
        readOnly: true,
        description: 'HMAC-SHA-256 hash of the authorization code plaintext.',
      },
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
      name: 'redirectUri',
      type: 'text',
      required: true,
      admin: { readOnly: true },
    },
    {
      name: 'scope',
      type: 'text',
      admin: { readOnly: true },
    },
    {
      name: 'codeChallenge',
      type: 'text',
      required: true,
      admin: { readOnly: true },
    },
    {
      name: 'codeChallengeMethod',
      type: 'select',
      required: true,
      defaultValue: 'S256',
      admin: { readOnly: true },
      options: [{ label: 'S256', value: 'S256' }],
    },
    {
      name: 'expiresAt',
      type: 'date',
      required: true,
      index: true,
      admin: { readOnly: true },
    },
    {
      name: 'consumedAt',
      type: 'date',
      admin: {
        readOnly: true,
        description: 'Set when the code is exchanged. Null means it has not been used.',
      },
    },
  ],
  labels: {
    singular: 'Auth Code',
    plural: 'Auth Codes',
  },
}
