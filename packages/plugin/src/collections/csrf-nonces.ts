import type { Access, CollectionAfterChangeHook, CollectionConfig } from 'payload'

const denyPublicAccess: Access = () => false

const sweepExpiredNonces: CollectionAfterChangeHook = async ({ operation, req }) => {
  if (operation !== 'create') return

  try {
    const now = new Date().toISOString()
    // Single bulk delete rather than find + N individual deletes — avoids the
    // write amplification / lock contention of up to 200 concurrent deletes on
    // every nonce creation.
    await req.payload.delete({
      collection: 'oauth-csrf-nonces',
      overrideAccess: true,
      where: {
        or: [
          { expiresAt: { less_than: now } },
          { consumedAt: { exists: true } },
        ],
      },
      req,
    })
  } catch {
    // sweep is best-effort; never block the create
  }
}

export const oauthCsrfNoncesCollection: CollectionConfig = {
  slug: 'oauth-csrf-nonces',
  // Server-managed — opt out of document-locking so no FK column is added to
  // payload_locked_documents_rels (avoids the SQLite push rebuild bug; see clients.ts).
  lockDocuments: false,
  admin: { hidden: true },
  access: {
    create: denyPublicAccess,
    read: denyPublicAccess,
    update: denyPublicAccess,
    delete: denyPublicAccess,
  },
  hooks: {
    afterChange: [sweepExpiredNonces],
  },
  fields: [
    {
      name: 'nonceHash',
      type: 'text',
      required: true,
      index: true,
      admin: { readOnly: true },
    },
    {
      name: 'userId',
      type: 'text',
      required: true,
      admin: { readOnly: true },
    },
    {
      name: 'expiresAt',
      type: 'date',
      required: true,
      admin: { readOnly: true },
    },
    {
      name: 'consumedAt',
      type: 'date',
      admin: { readOnly: true },
    },
  ],
}
