import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { config, createMcpOAuthMiddleware, mcpOAuthMiddleware } from '../../../src/next-middleware.js'

const MCP_HEADERS = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
}

function req(url: string, init?: { method?: string; headers?: Record<string, string> }): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3000'), {
    method: init?.method ?? 'GET',
    headers: init?.headers,
  })
}

// NextResponse.rewrite encodes the target in the `x-middleware-rewrite` header.
function rewriteTarget(res: ReturnType<typeof mcpOAuthMiddleware>): string | null {
  const raw = res.headers.get('x-middleware-rewrite')
  return raw ? new URL(raw).pathname : null
}

describe('createMcpOAuthMiddleware — .well-known discovery', () => {
  it('rewrites the authorization-server document to the API route', () => {
    const res = mcpOAuthMiddleware(req('/.well-known/oauth-authorization-server'))
    expect(rewriteTarget(res)).toBe('/api/.well-known/oauth-authorization-server')
  })

  it('rewrites the protected-resource document to the API route', () => {
    const res = mcpOAuthMiddleware(req('/.well-known/oauth-protected-resource'))
    expect(rewriteTarget(res)).toBe('/api/.well-known/oauth-protected-resource')
  })

  it('honours a custom apiRoute', () => {
    const mw = createMcpOAuthMiddleware({ apiRoute: '/payload-api' })
    const res = mw(req('/.well-known/oauth-protected-resource'))
    expect(rewriteTarget(res)).toBe('/payload-api/.well-known/oauth-protected-resource')
  })

  it('can be disabled', () => {
    const mw = createMcpOAuthMiddleware({ rewriteWellKnown: false })
    const res = mw(req('/.well-known/oauth-protected-resource'))
    expect(rewriteTarget(res)).toBeNull()
  })
})

describe('createMcpOAuthMiddleware — bare-host MCP rewrite', () => {
  it('rewrites a POST / that looks like an MCP client', () => {
    const res = mcpOAuthMiddleware(req('/', { method: 'POST', headers: MCP_HEADERS }))
    expect(rewriteTarget(res)).toBe('/api/mcp')
  })

  it('leaves a POST / without the MCP accept header alone', () => {
    const res = mcpOAuthMiddleware(
      req('/', { method: 'POST', headers: { 'content-type': 'application/json' } }),
    )
    expect(rewriteTarget(res)).toBeNull()
  })

  it('leaves a GET / alone', () => {
    const res = mcpOAuthMiddleware(req('/', { method: 'GET', headers: MCP_HEADERS }))
    expect(rewriteTarget(res)).toBeNull()
  })

  it('honours a custom mcpEndpointPath', () => {
    const mw = createMcpOAuthMiddleware({ mcpEndpointPath: '/api/custom-mcp' })
    const res = mw(req('/', { method: 'POST', headers: MCP_HEADERS }))
    expect(rewriteTarget(res)).toBe('/api/custom-mcp')
  })

  it('can be disabled', () => {
    const mw = createMcpOAuthMiddleware({ rewriteBareHostMcp: false })
    const res = mw(req('/', { method: 'POST', headers: MCP_HEADERS }))
    expect(rewriteTarget(res)).toBeNull()
  })
})

describe('exported config matcher', () => {
  it('covers the root and both discovery documents', () => {
    expect(config.matcher).toEqual([
      '/',
      '/.well-known/oauth-authorization-server',
      '/.well-known/oauth-protected-resource',
    ])
  })
})
