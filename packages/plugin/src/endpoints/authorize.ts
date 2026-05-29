import { renderToString } from 'react-dom/server'
import { createElement } from 'react'
import type { PayloadHandler } from 'payload'
import { ConsentScreen } from '../admin/ConsentScreen.js'
import { oauthErrorResponse, redirectResponse } from './helpers.js'

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
    const userId = String((user as Record<string, unknown>)['id'] ?? '')

    const html = '<!DOCTYPE html>' + renderToString(
      createElement(ConsentScreen, { clientName, scope, clientId, redirectUri, codeChallenge, codeChallengeMethod, state, userId }),
    )

    return new Response(html, {
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
