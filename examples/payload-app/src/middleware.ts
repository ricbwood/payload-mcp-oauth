import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  const { method, nextUrl } = request
  if (nextUrl.pathname.startsWith('/api/oauth') || nextUrl.pathname.startsWith('/.well-known')) {
    console.log(`[oauth-middleware] ${method} ${nextUrl.pathname}${nextUrl.search}`)
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/api/oauth/:path*', '/.well-known/:path*'],
}
