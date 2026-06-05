import type { Access, CollectionConfig } from 'payload'

// `create` is never a legitimate external operation: clients self-register via
// the Dynamic Client Registration endpoint (which uses `overrideAccess`). Deny
// it outright. `read`, `update`, and `delete` are gated to admins in plugin.ts
// via the resolved `adminAccess` rule.
//
// Security boundary: the gate must NOT be a bare `Boolean(req.user)` — that let
// ANY authenticated user rewrite a client's redirectUris (→ auth-code theft) or
// read/delete other users' tokens. The default `adminAccess` scopes to the
// configured admin user collection; see PayloadMcpOAuthConfig.adminAccess.
const denyPublicAccess: Access = () => false

export const oauthClientsCollection: CollectionConfig = {
  slug: 'oauth-clients',
  admin: {
    useAsTitle: 'clientName',
    group: 'MCP',
    defaultColumns: ['clientName', 'isActive', 'lastUsedAt', 'clientId'],
    description:
      'Apps connected via OAuth. Claude Desktop registers itself automatically — you only need this screen to review or deactivate connections.',
  },
  access: {
    create: denyPublicAccess,
    read: denyPublicAccess,
    update: denyPublicAccess,
    delete: denyPublicAccess,
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
      admin: { hidden: true },
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
      admin: { hidden: true },
      options: [{ label: 'Code', value: 'code' }],
    },
    {
      name: 'tokenEndpointAuthMethod',
      type: 'select',
      defaultValue: 'none',
      admin: { hidden: true },
      options: [{ label: 'None (public client)', value: 'none' }],
    },
    {
      name: 'softwareId',
      type: 'text',
      admin: { hidden: true },
    },
    {
      name: 'softwareVersion',
      type: 'text',
      admin: { hidden: true },
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
