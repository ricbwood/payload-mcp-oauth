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

  // Catch MCP clients that were configured with the bare host URL instead of
  // the full /api/mcp endpoint URL. Returning 200 with HTML lets the client
  // silently misbehave; respond with a structured 404 + JSON-RPC error so the
  // failure is loud and the correct endpoint is discoverable.
  if (nextUrl.pathname === '/' && method === 'POST' && looksLikeMcpClient(request)) {
    // nextUrl.origin reflects the internal Cloud Run container address on
    // Firebase App Hosting; derive the public URL from forwarded headers.
    const forwardedHost = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
    const forwardedProto = request.headers.get('x-forwarded-proto') ?? 'https'
    const publicOrigin = forwardedHost ? `${forwardedProto}://${forwardedHost}` : nextUrl.origin
    const mcpUrl = `${publicOrigin}${MCP_ENDPOINT_PATH}`
    console.warn(`[mcp-misconfig] POST / from MCP-shaped client — redirecting hint to ${mcpUrl}`)
    return NextResponse.json(
      {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32000,
          message: `MCP endpoint is not at the root path. Update your connector URL to: ${mcpUrl}`,
          data: { mcp_endpoint: mcpUrl },
        },
      },
      {
        status: 404,
        headers: {
          'Cache-Control': 'no-store',
          'X-MCP-Endpoint': mcpUrl,
        },
      },
    )
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/', '/api/oauth/:path*', '/.well-known/:path*'],
}
