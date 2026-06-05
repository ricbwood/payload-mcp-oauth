import type { PayloadRequest } from 'payload'

export function jsonResponse(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Strict-Transport-Security': 'max-age=31536000',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders,
    },
  })
}

export function oauthErrorResponse(status: number, error: string, description: string): Response {
  return jsonResponse({ error, error_description: description }, status)
}

export function redirectResponse(url: string, status = 302): Response {
  return new Response(null, { status, headers: { Location: url } })
}

export function htmlResponse(html: string, extraHeaders: Record<string, string> = {}): Response {
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff',
      // Not 'no-referrer': that makes browsers send `Origin: null` on form POSTs
      // from this page, which Payload rejects for cookie auth (→ 401). See the
      // detailed note in authorize.ts. Matches threat-model row I6.
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      "Content-Security-Policy": "default-src 'none'; form-action 'self'; base-uri 'none'",
      ...extraHeaders,
    },
  })
}

// Returns parsed body. Payload pre-parses into req.data in handler context;
// fall back to stream for cases where it isn't set (e.g. form-urlencoded).
export async function parseBody(req: PayloadRequest): Promise<Record<string, unknown>> {
  if (req.data && typeof req.data === 'object') {
    return req.data as Record<string, unknown>
  }
  const contentType = req.headers.get('content-type') ?? ''
  if (contentType.includes('application/x-www-form-urlencoded')) {
    const text = await req.text?.()
    if (text) return Object.fromEntries(new URLSearchParams(text))
    return {}
  }
  try {
    const data = await req.json?.()
    return (data as Record<string, unknown>) ?? {}
  } catch {
    return {}
  }
}
