import type { Access, CollectionConfig } from 'payload'

const isAuthenticated: Access = ({ req }) => Boolean(req.user)

export const oauthClientsCollection: CollectionConfig = {
  slug: 'oauth-clients',
  admin: {
    useAsTitle: 'clientName',
    group: 'OAuth',
    defaultColumns: ['clientId', 'clientName', 'isActive', 'lastUsedAt'],
    description: 'OAuth 2.1 clients registered via Dynamic Client Registration (RFC 7591).',
  },
  access: {
    create: isAuthenticated,
    read: isAuthenticated,
    update: isAuthenticated,
    delete: isAuthenticated,
  },
  timestamps: true,
  fields: [
    {
      name: 'clientId',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      admin: {
        readOnly: true,
        description: 'UUID assigned at registration. Immutable.',
      },
    },
    {
      name: 'clientName',
      type: 'text',
      admin: {
        description: 'Human-readable name shown on the consent screen.',
      },
    },
    {
      name: 'redirectUris',
      type: 'array',
      required: true,
      minRows: 1,
      admin: {
        description: 'Allowed redirect URIs. Exact-match enforced on every authorize request.',
      },
      fields: [
        {
          name: 'uri',
          type: 'text',
          required: true,
        },
      ],
    },
    {
      name: 'grantTypes',
      type: 'select',
      hasMany: true,
      defaultValue: ['authorization_code', 'refresh_token'],
      admin: { readOnly: true },
      options: [
        { label: 'Authorization Code', value: 'authorization_code' },
        { label: 'Refresh Token', value: 'refresh_token' },
      ],
    },
    {
      name: 'responseTypes',
      type: 'select',
      hasMany: true,
      defaultValue: ['code'],
      admin: { readOnly: true },
      options: [{ label: 'Code', value: 'code' }],
    },
    {
      name: 'tokenEndpointAuthMethod',
      type: 'select',
      defaultValue: 'none',
      admin: { readOnly: true },
      options: [{ label: 'None (public client)', value: 'none' }],
    },
    {
      name: 'softwareId',
      type: 'text',
      admin: {
        description: 'Optional software identifier from RFC 7591.',
        position: 'sidebar',
      },
    },
    {
      name: 'softwareVersion',
      type: 'text',
      admin: {
        description: 'Optional software version from RFC 7591.',
        position: 'sidebar',
      },
    },
    {
      name: 'isActive',
      type: 'checkbox',
      defaultValue: true,
      admin: {
        description: 'Deactivated clients cannot start new authorization flows.',
        position: 'sidebar',
      },
    },
    {
      name: 'lastUsedAt',
      type: 'date',
      admin: {
        readOnly: true,
        description: 'Updated on each successful token exchange.',
        position: 'sidebar',
      },
    },
  ],
  labels: {
    singular: 'OAuth Client',
    plural: 'OAuth Clients',
  },
}
