import { describe, expect, it } from 'vitest'
import { oauthAuthCodesCollection } from '../../../src/collections/auth-codes.js'

describe('oauthAuthCodesCollection', () => {
  it('has the correct slug', () => {
    expect(oauthAuthCodesCollection.slug).toBe('oauth-auth-codes')
  })

  it('has all required fields', () => {
    const fieldNames = oauthAuthCodesCollection.fields
      .filter((f): f is Extract<typeof f, { name: string }> => 'name' in f)
      .map((f) => f.name)

    expect(fieldNames).toContain('codeHash')
    expect(fieldNames).toContain('clientId')
    expect(fieldNames).toContain('userId')
    expect(fieldNames).toContain('redirectUri')
    expect(fieldNames).toContain('scope')
    expect(fieldNames).toContain('codeChallenge')
    expect(fieldNames).toContain('codeChallengeMethod')
    expect(fieldNames).toContain('expiresAt')
    expect(fieldNames).toContain('consumedAt')
  })

  it('marks codeHash as required, unique, and indexed', () => {
    const field = oauthAuthCodesCollection.fields.find(
      (f): f is Extract<typeof f, { name: string }> => 'name' in f && f.name === 'codeHash',
    )
    expect(field?.required).toBe(true)
    expect(field?.unique).toBe(true)
    expect(field?.index).toBe(true)
  })

  it('marks expiresAt as indexed', () => {
    const field = oauthAuthCodesCollection.fields.find(
      (f): f is Extract<typeof f, { name: string }> => 'name' in f && f.name === 'expiresAt',
    )
    expect(field?.index).toBe(true)
  })

  it('defaults codeChallengeMethod to S256', () => {
    const field = oauthAuthCodesCollection.fields.find(
      (f): f is Extract<typeof f, { name: string }> => 'name' in f && f.name === 'codeChallengeMethod',
    ) as { defaultValue?: unknown } | undefined
    expect(field?.defaultValue).toBe('S256')
  })

  it('has a sweeper afterChange hook', () => {
    expect(oauthAuthCodesCollection.hooks?.afterChange?.length).toBeGreaterThan(0)
  })

  it('has access control functions', () => {
    expect(typeof oauthAuthCodesCollection.access?.create).toBe('function')
    expect(typeof oauthAuthCodesCollection.access?.read).toBe('function')
  })

  it('has timestamps disabled', () => {
    expect(oauthAuthCodesCollection.timestamps).toBe(false)
  })
})
