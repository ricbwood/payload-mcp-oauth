import type React from 'react'
import type { AdminViewServerProps } from 'payload'

import { isOAuthAdmin } from './is-admin.js'

interface ClientDoc {
  id: string
  clientId: string
  clientName: string
  redirectUris: string[]
  grantTypes: string[]
  isActive: boolean
  lastUsedAt?: string
  createdAt?: string
}

/**
 * @deprecated The OAuth clients are now surfaced as a native admin collection
 * under the "MCP" nav group. This standalone view is retained for apps that
 * register it manually; prefer the native collection.
 */
export async function ClientsView({ initPageResult }: AdminViewServerProps): Promise<React.ReactElement> {
  // Payload passes AdminViewServerProps; the authenticated user and a scoped
  // Payload instance live on initPageResult.req (NOT as top-level props).
  const { user, payload } = initPageResult.req
  if (!user) {
    return (
      <div style={{ padding: '2rem' }}>
        <h1>OAuth Clients</h1>
        <p>You must be logged in to view this page.</p>
      </div>
    )
  }

  if (!isOAuthAdmin(user)) {
    return (
      <div style={{ padding: '2rem' }}>
        <h1>OAuth Clients</h1>
        <p style={{ color: '#dc2626' }}>Access denied. Admin privileges required.</p>
      </div>
    )
  }

  const { docs } = await payload.find({
    collection: 'oauth-clients',
    limit: 200,
    sort: '-createdAt',
  })

  const clients = docs as unknown as ClientDoc[]

  return (
    <div style={{ padding: '2rem' }}>
      <h1>OAuth Clients</h1>
      <p style={{ color: '#666', marginBottom: '1.5rem' }}>
        {clients.length} registered client{clients.length !== 1 ? 's' : ''}
      </p>
      {clients.length === 0 ? (
        <p>No clients registered yet.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={thStyle}>Client Name</th>
              <th style={thStyle}>Client ID</th>
              <th style={thStyle}>Redirect URIs</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Last Used</th>
              <th style={thStyle}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {clients.map((client) => (
              <tr key={client.id}>
                <td style={tdStyle}><strong>{client.clientName}</strong></td>
                <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: '0.85rem' }}>{client.clientId}</td>
                <td style={tdStyle}>
                  <ul style={{ margin: 0, padding: '0 0 0 1.2rem' }}>
                    {client.redirectUris.map((uri) => (
                      <li key={uri} style={{ fontSize: '0.85rem' }}>{uri}</li>
                    ))}
                  </ul>
                </td>
                <td style={tdStyle}>
                  <span style={{ color: client.isActive ? '#16a34a' : '#dc2626', fontWeight: 600 }}>
                    {client.isActive ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td style={tdStyle}>{client.lastUsedAt ? new Date(client.lastUsedAt).toLocaleString() : '—'}</td>
                <td style={tdStyle}>
                  <form method="POST" action={`/api/oauth/clients/${client.clientId}/toggle`} style={{ display: 'inline' }}>
                    <button type="submit" style={toggleStyle(client.isActive)}>
                      {client.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '0.5rem 0.75rem',
  borderBottom: '2px solid #e0e0e0',
  fontWeight: 600,
}

const tdStyle: React.CSSProperties = {
  padding: '0.5rem 0.75rem',
  borderBottom: '1px solid #f0f0f0',
  verticalAlign: 'top',
}

function toggleStyle(active: boolean): React.CSSProperties {
  return {
    padding: '0.25rem 0.75rem',
    background: active ? '#f59e0b' : '#16a34a',
    color: '#fff',
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: '0.85rem',
  }
}
