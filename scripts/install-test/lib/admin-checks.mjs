// User-visible admin assertions — the gap that let the #33 locked-collection
// regression ship (issue #43). The OAuth screens are NATIVE Payload collections
// under the "MCP" nav group, so "did the install work?" is not "does the import
// map reference a view" (an implementation detail) but "can an admin actually
// SEE and OPEN OAuth Clients / OAuth Tokens, while the public REST surface stays
// denied". We assert that observable outcome here.
//
// These run against the same booted dev server as the OAuth handshake. Kept in
// their own module (with their own login) so they don't entangle the handshake's
// single responsibility, and so the adminAccess-gate cases (issue #43, follow-up)
// have a natural home alongside them.

// The plugin's collection slugs + nav group are a stable contract (consumers and
// the README depend on them); assert against the literal values, not a probe.
const NAV_GROUP = 'MCP'
const OAUTH_COLLECTIONS = [
  { slug: 'oauth-clients', label: 'OAuth Clients' },
  { slug: 'oauth-tokens', label: 'OAuth Tokens' },
]

/** Log in to Payload and return the `payload-token=` cookie header (or ''). */
async function login(baseUrl, userSlug, email, password) {
  const res = await fetch(`${baseUrl}/api/${userSlug}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  return (res.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(';')[0])
    .filter((c) => c.startsWith('payload-token='))
    .join('; ')
}

/**
 * Assert the user-visible admin outcome for the OAuth collections.
 * @param {object} opts
 * @param {string} opts.baseUrl
 * @param {string} opts.email     seeded admin email
 * @param {string} opts.password  seeded admin password
 * @param {string} [opts.userSlug='users']  auth collection slug used to log in
 * @param {(name: string, ok: boolean, detail?: string) => void} opts.check
 */
export async function runAdminChecks({ baseUrl, email, password, userSlug = 'users', check }) {
  // 1. Public REST surface must be denied even before we authenticate — these
  //    collections deny read outright (admins use the admin UI, not the API).
  //    A regression that loosened access to `Boolean(req.user)` (or forgot the
  //    gate entirely) would let this through; assert 401/403, not 200.
  for (const { slug } of OAUTH_COLLECTIONS) {
    const res = await fetch(`${baseUrl}/api/${slug}?limit=0`)
    check(
      `access: unauthenticated GET /api/${slug} is denied (401/403)`,
      res.status === 401 || res.status === 403,
      `status=${res.status} — public read of ${slug} must be denied`,
    )
  }

  // 2. Log in as the seeded admin to reach the admin UI.
  const cookie = await login(baseUrl, userSlug, email, password)
  check('admin: seeded admin can log in', cookie.length > 0, 'no payload-token cookie returned from login')
  if (!cookie) return

  // 3. Nav visibility — the SSR admin shell must list both collections under the
  //    "MCP" group. Match on the deterministic list-route href (slug-derived,
  //    not escaped) plus the literal group label and plural labels, so a nav that
  //    silently dropped the OAuth screens (the #33 regression) fails here.
  const dashRes = await fetch(`${baseUrl}/admin`, { headers: { cookie } })
  const dashHtml = dashRes.status === 200 ? await dashRes.text() : ''
  check(
    `admin: dashboard groups the OAuth collections under "${NAV_GROUP}"`,
    dashRes.status === 200 && dashHtml.includes(NAV_GROUP),
    `status=${dashRes.status} — expected the "${NAV_GROUP}" nav group in the admin shell`,
  )
  for (const { slug, label } of OAUTH_COLLECTIONS) {
    check(
      `admin: nav links to ${label} (/admin/collections/${slug})`,
      dashHtml.includes(`/admin/collections/${slug}`) && dashHtml.includes(label),
      `the admin nav did not surface ${label} — it must be visible, not hidden/dropped`,
    )
  }

  // 4. List routes must actually render the collection list VIEW for an admin —
  //    a 200 that is really an "unauthorized"/error shell doesn't count. Assert a
  //    positive, slug-specific signal: Payload's List view roots its markup in
  //    `collection-list collection-list--<slug>`, emitted only when that
  //    collection's list actually renders. (We can't sniff for a denial phrase:
  //    Payload embeds i18n strings like "not allowed to" in every admin page's
  //    hydration payload, so absence-of-phrase gives false negatives.)
  for (const { slug, label } of OAUTH_COLLECTIONS) {
    const listRes = await fetch(`${baseUrl}/admin/collections/${slug}`, { headers: { cookie } })
    const listHtml = listRes.status === 200 ? await listRes.text() : ''
    check(
      `admin: ${label} list route renders for an admin`,
      listRes.status === 200 && listHtml.includes(`collection-list--${slug}`),
      `status=${listRes.status} — the ${slug} list view did not render for the seeded admin (no collection-list--${slug} root)`,
    )
  }
}
