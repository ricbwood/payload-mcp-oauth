import type { TypedUser } from 'payload'

/**
 * Best-effort admin check for the standalone OAuth admin views.
 *
 * If the app's user has an explicit role system (`role`, `isAdmin`, or a
 * `roles` array) we honour it. Otherwise — e.g. the default Payload starters,
 * whose `users` collection has no role field — reaching a server-rendered admin
 * view already means the request passed the user collection's admin auth, so we
 * treat the user as authorised rather than locking everyone out.
 *
 * Note: the native `oauth-clients` / `oauth-tokens` collections enforce the
 * stronger, configurable `adminAccess` rule (see PayloadMcpOAuthConfig). This
 * helper only backs the legacy standalone views.
 */
export function isOAuthAdmin(user: TypedUser): boolean {
  const u = user as Record<string, unknown>
  if ('role' in u) return u['role'] === 'admin'
  if ('isAdmin' in u) return u['isAdmin'] === true
  if (Array.isArray(u['roles'])) return (u['roles'] as string[]).includes('admin')
  return true
}
