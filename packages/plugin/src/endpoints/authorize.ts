import type { PayloadHandler } from 'payload'
import { oauthErrorResponse, redirectResponse, htmlResponse } from './helpers.js'

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

    const registered = client['redirectUris'] as string[]
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
    const scopeDisplay = scope || '(no specific scope)'
    const userId = String((user as Record<string, unknown>)['id'] ?? '')

    return htmlResponse(
      consentHtml({ clientName, scope: scopeDisplay, clientId, redirectUri, codeChallenge, codeChallengeMethod: 'S256', state, userId, scopeRaw: scope }),
    )
  }
}

interface ConsentParams {
  clientName: string
  scope: string
  scopeRaw: string
  clientId: string
  redirectUri: string
  codeChallenge: string
  codeChallengeMethod: string
  state: string
  userId: string
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function consentHtml(p: ConsentParams): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Authorize ${escape(p.clientName)}</title></head>
<body>
<h1>Authorize ${escape(p.clientName)}</h1>
<p>The application is requesting access: <strong>${escape(p.scope)}</strong></p>
<form method="POST" action="/api/oauth/consent">
  <input type="hidden" name="client_id" value="${escape(p.clientId)}">
  <input type="hidden" name="redirect_uri" value="${escape(p.redirectUri)}">
  <input type="hidden" name="code_challenge" value="${escape(p.codeChallenge)}">
  <input type="hidden" name="code_challenge_method" value="${escape(p.codeChallengeMethod)}">
  <input type="hidden" name="state" value="${escape(p.state)}">
  <input type="hidden" name="user_id" value="${escape(p.userId)}">
  <input type="hidden" name="scope" value="${escape(p.scopeRaw)}">
  <button type="submit" name="decision" value="approve">Approve</button>
  <button type="submit" name="decision" value="deny">Deny</button>
</form>
</body>
</html>`
}
