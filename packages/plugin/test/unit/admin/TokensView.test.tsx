import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { TokensView } from '../../../src/admin/TokensView.js'

function makePayload(docs: unknown[] = []) {
  return {
    find: vi.fn().mockResolvedValue({ docs }),
  }
}

// Payload passes AdminViewServerProps; the view reads user + payload from
// initPageResult.req. Build that shape for the tests.
function props(payload: unknown, user: unknown) {
  return { initPageResult: { req: { payload, user } } } as never
}

function makeToken(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tok-1',
    tokenType: 'access',
    clientId: 'client-1',
    scope: 'posts:read',
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    revokedAt: null,
    ...overrides,
  }
}

describe('TokensView', () => {
  it('shows login prompt when user is null', async () => {
    const payload = makePayload()
    const html = renderToString(await TokensView(props(payload, null)))
    expect(html).toContain('logged in')
    expect(payload.find).not.toHaveBeenCalled()
  })

  it('renders a table of active tokens', async () => {
    const payload = makePayload([makeToken()])
    const html = renderToString(await TokensView(props(payload, { id: 'admin-1', role: 'admin' })))
    expect(html).toContain('client-1')
    expect(html).toContain('posts:read')
    expect(html).toContain('Revoke')
  })

  it('non-admin user query filters by userId', async () => {
    const payload = makePayload([makeToken()])
    await TokensView(props(payload, { id: 'user-1', role: 'editor' }))
    const whereArg = (payload.find.mock.calls[0] as [{ where: unknown }])[0].where
    expect(JSON.stringify(whereArg)).toContain('user-1')
  })

  it('admin user query does NOT filter by userId (sees all)', async () => {
    const payload = makePayload([makeToken()])
    await TokensView(props(payload, { id: 'admin-1', role: 'admin' }))
    const whereArg = (payload.find.mock.calls[0] as [{ where: unknown }])[0].where
    expect(JSON.stringify(whereArg)).not.toContain('admin-1')
  })

  it('shows "No active tokens" when list is empty', async () => {
    const payload = makePayload([])
    const html = renderToString(await TokensView(props(payload, { id: 'admin-1', role: 'admin' })))
    expect(html).toContain('No active tokens')
  })

  it('revoke form posts to /api/oauth/revoke', async () => {
    const payload = makePayload([makeToken()])
    const html = renderToString(await TokensView(props(payload, { id: 'admin-1', role: 'admin' })))
    expect(html).toContain('action="/api/oauth/revoke"')
  })
})
