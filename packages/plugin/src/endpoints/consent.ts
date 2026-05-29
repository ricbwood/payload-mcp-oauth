import type { PayloadHandler } from 'payload'
import { issueAuthCode } from '../lib/auth-codes.js'
import { oauthErrorResponse, redirectResponse, parseBody } from './helpers.js'

export function makeConsentHandler(): PayloadHandler {
  return async (req) => {
    if (req.method !== 'POST') {
      return oauthErrorResponse(405, 'invalid_request', 'Method not allowed')
    }

    const body = await parseBody(req)

    const decision = body['decision'] as string | undefined
    const clientId = body['client_id'] as string | undefined
    const redirectUri = body['redirect_uri'] as string | undefined
    const codeChallenge = body['code_challenge'] as string | undefined
    const codeChallengeMethod = body['code_challenge_method'] as string | undefined
    const state = body['state'] as string | undefined
    const userId = body['user_id'] as string | undefined
    const scope = (body['scope'] as string | undefined) ?? ''

    if (!clientId || !redirectUri || !codeChallenge || !codeChallengeMethod || !state || !userId) {
      return oauthErrorResponse(400, 'invalid_request', 'Missing required consent parameters')
    }

    if (decision === 'deny') {
      const url = new URL(redirectUri)
      url.searchParams.set('error', 'access_denied')
      url.searchParams.set('error_description', 'The user denied the authorization request')
      url.searchParams.set('state', state)
      return redirectResponse(url.toString())
    }

    if (decision !== 'approve') {
      return oauthErrorResponse(400, 'invalid_request', 'decision must be approve or deny')
    }

    const { docs } = await req.payload.find({
      collection: 'oauth-clients',
      where: { clientId: { equals: clientId }, isActive: { equals: true } },
      limit: 1,
    })
    const client = docs[0]
    if (!client) {
      return oauthErrorResponse(400, 'invalid_client', 'Unknown client_id')
    }
    const registered = (client['redirectUris'] as Array<{ uri: string }>).map((r) => r.uri)
    if (!registered.includes(redirectUri)) {
      return oauthErrorResponse(400, 'invalid_redirect_uri', 'redirect_uri does not match registered URIs')
    }

    if (codeChallengeMethod !== 'S256') {
      return oauthErrorResponse(400, 'invalid_request', 'code_challenge_method must be S256')
    }

    const code = await issueAuthCode(req.payload, {
      clientId,
      userId,
      redirectUri,
      scope,
      codeChallenge,
      codeChallengeMethod,
    })

    const url = new URL(redirectUri)
    url.searchParams.set('code', code)
    url.searchParams.set('state', state)
    return redirectResponse(url.toString())
  }
}
