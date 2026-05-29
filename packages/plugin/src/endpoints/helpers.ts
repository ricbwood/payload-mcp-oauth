import type { PayloadRequest } from 'payload'

export function jsonResponse(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return Response.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store', ...extraHeaders },
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
      'Referrer-Policy': 'no-referrer',
      "Content-Security-Policy": "default-src 'none'; form-action 'self'; base-uri 'none'",
      ...extraHeaders,
    },
  })
}

// Returns parsed body. JSON content-type → object with original types.
// x-www-form-urlencoded → flat Record<string, string>.
export async function parseBody(req: PayloadRequest): Promise<Record<string, unknown>> {
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
