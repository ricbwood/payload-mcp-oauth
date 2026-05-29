import { renderToString } from 'react-dom/server'
import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { ConsentScreen } from '../../../src/admin/ConsentScreen.js'
import type { ConsentScreenProps } from '../../../src/admin/ConsentScreen.js'

const BASE_PROPS: ConsentScreenProps = {
  clientName: 'My App',
  scope: 'posts:read',
  clientId: 'client-1',
  redirectUri: 'https://example.com/cb',
  codeChallenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  codeChallengeMethod: 'S256',
  state: 'state-xyz',
  userId: 'user-1',
}

function render(props: ConsentScreenProps): string {
  return renderToString(createElement(ConsentScreen, props))
}

describe('ConsentScreen', () => {
  it('renders client name in the title', () => {
    const html = render(BASE_PROPS)
    expect(html).toContain('My App')
  })

  it('renders all hidden form fields', () => {
    const html = render(BASE_PROPS)
    expect(html).toContain('name="client_id"')
    expect(html).toContain('name="redirect_uri"')
    expect(html).toContain('name="code_challenge"')
    expect(html).toContain('name="code_challenge_method"')
    expect(html).toContain('name="state"')
    expect(html).toContain('name="user_id"')
    expect(html).toContain('name="scope"')
  })

  it('posts to /api/oauth/consent', () => {
    const html = render(BASE_PROPS)
    expect(html).toContain('action="/api/oauth/consent"')
  })

  it('renders Approve and Deny buttons', () => {
    const html = render(BASE_PROPS)
    expect(html).toContain('value="approve"')
    expect(html).toContain('value="deny"')
  })

  it('escapes XSS in client_name — angle brackets become entities', () => {
    const html = render({ ...BASE_PROPS, clientName: '<script>alert(1)</script>' })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('escapes XSS in scope', () => {
    const html = render({ ...BASE_PROPS, scope: '"><img src=x onerror=alert(1)>' })
    expect(html).toContain('&lt;img')
    expect(html).not.toContain('<img')
  })

  it('maps known scope tokens to human-readable labels', () => {
    const html = render({ ...BASE_PROPS, scope: 'posts:read posts:write' })
    expect(html).toContain('Read posts')
    expect(html).toContain('Create and update posts')
  })

  it('falls back to raw scope token for unknown scopes', () => {
    const html = render({ ...BASE_PROPS, scope: 'custom:widget' })
    expect(html).toContain('custom:widget')
  })

  it('accepts pre-computed scopeLabels', () => {
    const html = render({ ...BASE_PROPS, scopeLabels: ['Read everything', 'Write everything'] })
    expect(html).toContain('Read everything')
    expect(html).toContain('Write everything')
  })

  it('contains no inline event handlers (XSS vector)', () => {
    const html = render(BASE_PROPS)
    expect(html).not.toMatch(/ on[a-z]+=/)
  })
})
