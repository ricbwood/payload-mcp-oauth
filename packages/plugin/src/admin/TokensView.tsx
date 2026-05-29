import type React from 'react'
import type { Payload, TypedUser, Where } from 'payload'

export interface TokensViewProps {
  payload: Payload
  user: TypedUser | null | undefined
}

interface TokenDoc {
  id: string
  tokenType: string
  clientId: string
  scope: string
  expiresAt: string
  lastUsedAt?: string
  revokedAt?: string | null
}

export async function TokensView({ payload, user }: TokensViewProps): Promise<React.ReactElement> {
  if (!user) {
    return (
      <div>
        <h1>Active OAuth Tokens</h1>
        <p>You must be logged in to view this page.</p>
      </div>
    )
  }

  const userId = String((user as Record<string, unknown>)['id'] ?? '')
  const isAdmin = (user as Record<string, unknown>)['role'] === 'admin' ||
    Boolean((user as Record<string, unknown>)['_verified'])

  // Admins see all active tokens; users see only their own
  const whereClause: Where = isAdmin
    ? { revokedAt: { equals: null } }
    : { and: [{ userId: { equals: userId } }, { revokedAt: { equals: null } }] }

  const { docs } = await payload.find({
    collection: 'oauth-tokens',
    where: whereClause,
    limit: 100,
    sort: '-createdAt',
  })

  const tokens = docs as unknown as TokenDoc[]

  return (
    <div style={{ padding: '2rem' }}>
      <h1>Active OAuth Tokens</h1>
      {tokens.length === 0 ? (
        <p>No active tokens found.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={thStyle}>Type</th>
              <th style={thStyle}>Client ID</th>
              <th style={thStyle}>Scope</th>
              <th style={thStyle}>Expires</th>
              <th style={thStyle}>Last Used</th>
              <th style={thStyle}>Action</th>
            </tr>
          </thead>
          <tbody>
            {tokens.map((token) => (
              <tr key={token.id}>
                <td style={tdStyle}>{token.tokenType}</td>
                <td style={tdStyle}>{token.clientId}</td>
                <td style={tdStyle}>{token.scope || '—'}</td>
                <td style={tdStyle}>{new Date(token.expiresAt).toLocaleString()}</td>
                <td style={tdStyle}>{token.lastUsedAt ? new Date(token.lastUsedAt).toLocaleString() : '—'}</td>
                <td style={tdStyle}>
                  <form method="POST" action="/api/oauth/revoke">
                    <input type="hidden" name="token_id" value={token.id} />
                    <button type="submit" style={revokeStyle}>Revoke</button>
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
}

const revokeStyle: React.CSSProperties = {
  padding: '0.25rem 0.75rem',
  background: '#dc2626',
  color: '#fff',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
}
