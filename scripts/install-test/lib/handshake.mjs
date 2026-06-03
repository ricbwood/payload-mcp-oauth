// Reusable HTTP driver for the full OAuth 2.1 + PKCE handshake against a running
// app, plus the post-handshake assertions that prove the MCP wrapper is wired.
//
// This is the payoff of the install test: it does exactly what Claude.ai does —
// register → log in → authorize → consent → exchange code for a token → call the
// MCP endpoint with that token — and asserts each step. If the "same mcpOptions
// object" wiring gotcha (or wrong plugin order) is present, the OAuth token 401s
// at the MCP endpoint and this fails, which is precisely the silent failure mode
// the README warns about.

import { createHash, randomBytes } from 'node:crypto'

const REDIRECT_URI_PATH = '/oauth/callback'

/** RFC 7636 S256: verifier is 43-128 chars base64url; challenge = b64url(sha256(verifier)). */
function makePkce() {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
}

/** Pull the hidden form fields out of the server-rendered consent page. */
function parseConsentFields(html) {
  const fields = {}
  const re = /<input[^>]*type="hidden"[^>]*name="([^"]+)"[^>]*value="([^"]*)"[^>]*>/g
  let m
  while ((m = re.exec(html)) !== null) {
    fields[m[1]] = decodeEntities(m[2])
  }
  return fields
}

/**
 * Runs the full handshake and the wrapper assertions.
 * @param {object} opts
 * @param {string} opts.baseUrl   e.g. http://localhost:4319
 * @param {string} opts.email     admin user email (already seeded)
 * @param {string} opts.password  admin user password
 * @param {(name: string, ok: boolean, detail?: string) => void} opts.check  assertion sink
 */
export async function runHandshake({ baseUrl, email, password, check }) {
  const redirectUri = `${baseUrl}${REDIRECT_URI_PATH}`

  // 1. Discovery — request the BARE well-known paths. These only resolve if the
  //    Next middleware rewrites them to /api/.well-known/...; a missing/mis-matched
  //    middleware returns the app's HTML or a 404 here (README troubleshooting row 3).
  const asRes = await fetch(`${baseUrl}/.well-known/oauth-authorization-server`)
  const asJson = await asRes.json().catch(() => null)
  check(
    'discovery: /.well-known/oauth-authorization-server returns JSON (proxy/middleware wired)',
    asRes.status === 200 && !!asJson?.issuer && !!asJson?.registration_endpoint && !!asJson?.token_endpoint,
    `status=${asRes.status} issuer=${asJson?.issuer}`,
  )

  const prmRes = await fetch(`${baseUrl}/.well-known/oauth-protected-resource`)
  const prmJson = await prmRes.json().catch(() => null)
  check(
    'discovery: /.well-known/oauth-protected-resource returns JSON',
    prmRes.status === 200 && Array.isArray(prmJson?.authorization_servers),
    `status=${prmRes.status}`,
  )

  // 2. Dynamic Client Registration (RFC 7591).
  const regRes = await fetch(`${baseUrl}/api/oauth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'install-test client',
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: 'none',
    }),
  })
  const reg = await regRes.json().catch(() => null)
  check('register: POST /api/oauth/register returns client_id', regRes.status === 201 && !!reg?.client_id, `status=${regRes.status}`)
  if (!reg?.client_id) return

  // 3. Log in to Payload to obtain the session cookie the authorize endpoint needs.
  const loginRes = await fetch(`${baseUrl}/api/users/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const cookie = (loginRes.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(';')[0])
    .filter((c) => c.startsWith('payload-token='))
    .join('; ')
  check('login: POST /api/users/login sets payload-token cookie', loginRes.status === 200 && cookie.length > 0, `status=${loginRes.status}`)
  if (!cookie) return

  // 4. Authorize — with the cookie this renders the consent page (200 HTML).
  const { verifier, challenge } = makePkce()
  const state = randomBytes(8).toString('hex')
  const authQs = new URLSearchParams({
    response_type: 'code',
    client_id: reg.client_id,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    scope: 'users:read',
  })
  const authRes = await fetch(`${baseUrl}/api/oauth/authorize?${authQs}`, {
    headers: { cookie },
    redirect: 'manual',
  })
  const authHtml = authRes.status === 200 ? await authRes.text() : ''
  const fields = parseConsentFields(authHtml)
  check(
    'authorize: GET /api/oauth/authorize renders consent page',
    authRes.status === 200 && !!fields.csrf_token && !!fields.user_id,
    `status=${authRes.status} (302 here means login/session failed)`,
  )
  if (!fields.csrf_token) return

  // 5. Consent — approve. Returns a 302 to redirect_uri?code=...
  const consentBody = new URLSearchParams({ ...fields, decision: 'approve' })
  const consentRes = await fetch(`${baseUrl}/api/oauth/consent`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: consentBody,
    redirect: 'manual',
  })
  const location = consentRes.headers.get('location') ?? ''
  const code = location ? new URL(location).searchParams.get('code') : null
  check('consent: POST /api/oauth/consent issues an auth code', (consentRes.status === 302 || consentRes.status === 303) && !!code, `status=${consentRes.status} location=${location}`)
  if (!code) return

  // 6. Token exchange.
  const tokenRes = await fetch(`${baseUrl}/api/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: reg.client_id,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }),
  })
  const token = await tokenRes.json().catch(() => null)
  const accessToken = token?.access_token
  check(
    'token: POST /api/oauth/token returns a pmoauth_ access token',
    tokenRes.status === 200 && typeof accessToken === 'string' && accessToken.startsWith('pmoauth_'),
    `status=${tokenRes.status}`,
  )
  if (!accessToken) return

  // 7. THE wiring proof — call the MCP endpoint with the OAuth token. If the
  //    overrideAuth hook wasn't installed on the live mcpOptions reference (the
  //    object-identity gotcha) or the plugins are mis-ordered, this 401s while
  //    API keys would still work — exactly the trap the README calls out.
  const mcpBody = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'install-test', version: '1.0.0' } },
  })
  const mcpRes = await fetch(`${baseUrl}/api/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${accessToken}` },
    body: mcpBody,
  })
  check(
    'MCP: /api/mcp accepts the OAuth token (overrideAuth wired to live options)',
    mcpRes.status !== 401 && mcpRes.status < 500,
    `status=${mcpRes.status} — a 401 here is the "same mcpOptions object" / plugin-order gotcha`,
  )

  // 8. Negative: an unauthenticated MCP call must get a spec-compliant 401 that
  //    points clients at the protected-resource metadata (proves the wrapper).
  const unauthRes = await fetch(`${baseUrl}/api/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: mcpBody,
  })
  const wwwAuth = unauthRes.headers.get('www-authenticate') ?? ''
  check(
    'MCP: unauthenticated call returns 401 with resource_metadata challenge',
    unauthRes.status === 401 && wwwAuth.includes('resource_metadata='),
    `status=${unauthRes.status} www-authenticate=${wwwAuth}`,
  )
}
