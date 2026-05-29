import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ClientsView } from '../../../src/admin/ClientsView.js'

function makePayload(docs: unknown[] = []) {
  return {
    find: vi.fn().mockResolvedValue({ docs }),
  }
}

function makeClient(overrides: Record<string, unknown> = {}) {
  return {
    id: 'client-doc-1',
    clientId: 'client-uuid-1',
    clientName: 'Test App',
    redirectUris: ['https://example.com/cb'],
    grantTypes: ['authorization_code'],
    isActive: true,
    ...overrides,
  }
}

describe('ClientsView', () => {
  it('shows login prompt when user is null', async () => {
    const html = renderToString(await ClientsView({ payload: makePayload() as never, user: null }))
    expect(html).toContain('logged in')
  })

  it('shows 403-style message for non-admin users', async () => {
    const payload = makePayload()
    const html = renderToString(
      await ClientsView({ payload: payload as never, user: { id: 'u1', role: 'editor' } as never }),
    )
    expect(html).toContain('Access denied')
    expect(payload.find).not.toHaveBeenCalled()
  })

  it('renders client list for admin users', async () => {
    const payload = makePayload([makeClient()])
    const html = renderToString(
      await ClientsView({ payload: payload as never, user: { id: 'u1', role: 'admin' } as never }),
    )
    expect(html).toContain('Test App')
    expect(html).toContain('client-uuid-1')
    expect(html).toContain('Active')
  })

  it('shows deactivate button for active clients', async () => {
    const payload = makePayload([makeClient({ isActive: true })])
    const html = renderToString(
      await ClientsView({ payload: payload as never, user: { id: 'u1', role: 'admin' } as never }),
    )
    expect(html).toContain('Deactivate')
  })

  it('shows activate button for inactive clients', async () => {
    const payload = makePayload([makeClient({ isActive: false })])
    const html = renderToString(
      await ClientsView({ payload: payload as never, user: { id: 'u1', role: 'admin' } as never }),
    )
    expect(html).toContain('Activate')
  })

  it('shows "No clients" message when list is empty', async () => {
    const payload = makePayload([])
    const html = renderToString(
      await ClientsView({ payload: payload as never, user: { id: 'u1', role: 'admin' } as never }),
    )
    expect(html).toContain('No clients')
  })

  it('admin via isAdmin flag also passes access check', async () => {
    const payload = makePayload([makeClient()])
    const html = renderToString(
      await ClientsView({ payload: payload as never, user: { id: 'u1', isAdmin: true } as never }),
    )
    expect(html).not.toContain('Access denied')
    expect(html).toContain('Test App')
  })
})
