import type { PayloadHandler } from 'payload'
import { oauthErrorResponse, redirectResponse } from './helpers.js'

const SCOPE_LABELS: Record<string, string> = {
  'posts:read': 'Read posts',
  'posts:write': 'Create and update posts',
  'posts:delete': 'Delete posts',
  'media:read': 'Read media files',
  'media:write': 'Upload and manage media',
  'users:read': 'Read user profiles',
  openid: 'Confirm your identity',
  profile: 'Access your profile information',
  email: 'Access your email address',
}

function e(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;')
}

function buildConsentHtml(p: {
  clientName: string
  scope: string
  clientId: string
  redirectUri: string
  codeChallenge: string
  codeChallengeMethod: string
  state: string
  userId: string
}): string {
  const labels = p.scope.trim()
    ? p.scope.split(/\s+/).filter(Boolean).map((s) => SCOPE_LABELS[s] ?? s)
    : ['Access your Payload CMS instance']
  const items = labels.map((l) => `<li>${e(l)}</li>`).join('')
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Authorize ${e(p.clientName)}</title>
<style>
body{font-family:system-ui,sans-serif;max-width:480px;margin:80px auto;padding:0 1rem}
h1{font-size:1.25rem;margin-bottom:0.5rem}
.scope-list{list-style:disc;padding-left:1.5rem;margin:1rem 0}
.actions{display:flex;gap:0.75rem;margin-top:1.5rem}
.btn{padding:0.5rem 1.25rem;border:none;border-radius:4px;cursor:pointer;font-size:1rem}
.btn-approve{background:#0070f3;color:#fff}
.btn-deny{background:#f0f0f0;color:#333}
</style>
</head><body>
<h1>Authorize <strong>${e(p.clientName)}</strong></h1>
<p>This application is requesting the following permissions:</p>
<ul class="scope-list">${items}</ul>
<form method="POST" action="/api/oauth/consent">
<input type="hidden" name="client_id" value="${e(p.clientId)}">
<input type="hidden" name="redirect_uri" value="${e(p.redirectUri)}">
<input type="hidden" name="code_challenge" value="${e(p.codeChallenge)}">
<input type="hidden" name="code_challenge_method" value="${e(p.codeChallengeMethod)}">
<input type="hidden" name="state" value="${e(p.state)}">
<input type="hidden" name="user_id" value="${e(p.userId)}">
<input type="hidden" name="scope" value="${e(p.scope)}">
<div class="actions">
<button type="submit" name="decision" value="approve" class="btn btn-approve">Approve</button>
<button type="submit" name="decision" value="deny" class="btn btn-deny">Deny</button>
</div>
</form>
</body></html>`
}

function errorRedirect(redirectUri: string | null, error: string, description: string, state?: string): Response {
  if (!redirectUri) {
    return oauthErrorResponse(400, error, description)
  }
  const url = new URL(redirectUri)
  url.searchParams.set('error', error)
  url.searchParams.set('error_description', description)
  if (state) url.searchParams.set('state', state)
  return redirectResponse(url.toString())
}

export function makeAuthorizeHandler(adminPath = '/admin', loginPath?: string): PayloadHandler {
  return async (req) => {
    const q = req.query as Record<string, string | undefined>
    const responseType = q['response_type']
    const clientId = q['client_id']
    const redirectUri = q['redirect_uri']
    const codeChallenge = q['code_challenge']
    const codeChallengeMethod = q['code_challenge_method']
    const state = q['state']
    const scope = q['scope'] ?? ''

    if (responseType !== 'code') {
      return errorRedirect(null, 'unsupported_response_type', 'Only response_type=code is supported', state)
    }

    if (!clientId || typeof clientId !== 'string') {
      return errorRedirect(null, 'invalid_request', 'client_id is required', state)
    }

    const { docs } = await req.payload.find({
      collection: 'oauth-clients',
      where: { clientId: { equals: clientId }, isActive: { equals: true } },
      limit: 1,
    })
    const client = docs[0]

    if (!client) {
      return errorRedirect(null, 'invalid_client', 'Unknown client_id', state)
    }

    const registered = (client['redirectUris'] as Array<{ uri: string }>).map((r) => r.uri)
    if (!redirectUri || !registered.includes(redirectUri)) {
      return errorRedirect(null, 'invalid_redirect_uri', 'redirect_uri does not match registered URIs', state)
    }

    if (!codeChallenge || typeof codeChallenge !== 'string') {
      return errorRedirect(redirectUri, 'invalid_request', 'code_challenge is required', state)
    }

    if (codeChallengeMethod !== 'S256') {
      return errorRedirect(redirectUri, 'invalid_request', 'code_challenge_method must be S256', state)
    }

    if (!state || typeof state !== 'string') {
      return errorRedirect(redirectUri, 'invalid_request', 'state is required', state)
    }

    const user = req.user
    if (!user) {
      const resolvedLogin = loginPath ?? `${adminPath}/login`
      const returnTo = encodeURIComponent(req.url ?? '/api/oauth/authorize')
      return redirectResponse(`${resolvedLogin}?redirect=${returnTo}`)
    }

    const clientName = String(client['clientName'] ?? clientId)
    const userId = String((user as Record<string, unknown>)['id'] ?? '')

    return new Response(buildConsentHtml({ clientName, scope, clientId, redirectUri, codeChallenge, codeChallengeMethod, state, userId }), {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Frame-Options': 'DENY',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'",
      },
    })
  }
}
