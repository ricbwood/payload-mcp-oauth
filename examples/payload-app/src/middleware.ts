import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const MCP_ENDPOINT_PATH = '/api/mcp'

function looksLikeMcpClient(request: NextRequest): boolean {
  const accept = request.headers.get('accept') ?? ''
  const contentType = request.headers.get('content-type') ?? ''
  return (
    accept.includes('text/event-stream') ||
    contentType.includes('application/json')
  )
}

export function middleware(request: NextRequest) {
  const { method, nextUrl } = request

  if (nextUrl.pathname.startsWith('/api/oauth') || nextUrl.pathname.startsWith('/.well-known')) {
    console.log(`[oauth-middleware] ${method} ${nextUrl.pathname}${nextUrl.search}`)
  }

  // MCP clients registered with the bare host URL (no /api/mcp suffix) POST
  // their JSON-RPC payloads to the root, which Next.js otherwise answers with
  // the home page HTML (200). Internally rewrite to /api/mcp so the bare-host
  // form Just Works while the request body, method, and headers are preserved.
  if (nextUrl.pathname === '/' && method === 'POST' && looksLikeMcpClient(request)) {
    console.log(`[mcp-rewrite] POST / → ${MCP_ENDPOINT_PATH}`)
    const rewritten = nextUrl.clone()
    rewritten.pathname = MCP_ENDPOINT_PATH
    return NextResponse.rewrite(rewritten)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/', '/api/oauth/:path*', '/.well-known/:path*'],
}
