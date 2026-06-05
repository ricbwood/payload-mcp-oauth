import type { Access, CollectionAfterChangeHook, CollectionConfig } from 'payload'

const denyPublicAccess: Access = () => false

const sweepExpiredNonces: CollectionAfterChangeHook = async ({ operation, req }) => {
  if (operation !== 'create') return

  try {
    const now = new Date().toISOString()
    const stale = await req.payload.find({
      collection: 'oauth-csrf-nonces',
      overrideAccess: true,
      where: {
        or: [
          { expiresAt: { less_than: now } },
          { consumedAt: { exists: true } },
        ],
      },
      limit: 200,
      pagination: false,
      req,
    })
    await Promise.all(
      stale.docs.map((n) =>
        req.payload
          .delete({ collection: 'oauth-csrf-nonces', id: n.id, overrideAccess: true, req })
          .catch((err) => {
            req.payload.logger?.warn(`[pmoauth] sweepExpiredNonces: failed to delete id=${n.id}: ${String(err)}`)
          }),
      ),
    )
  } catch {
    // sweep is best-effort; never block the create
  }
}

export const oauthCsrfNoncesCollection: CollectionConfig = {
  slug: 'oauth-csrf-nonces',
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
