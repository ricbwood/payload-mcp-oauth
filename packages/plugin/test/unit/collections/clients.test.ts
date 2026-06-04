import { describe, expect, it } from 'vitest'
import { oauthClientsCollection } from '../../../src/collections/clients.js'

describe('oauthClientsCollection', () => {
  it('has the correct slug', () => {
    expect(oauthClientsCollection.slug).toBe('oauth-clients')
  })

  it('has all required fields', () => {
    const fieldNames = oauthClientsCollection.fields
      .filter((f): f is Extract<typeof f, { name: string }> => 'name' in f)
      .map((f) => f.name)

    expect(fieldNames).toContain('clientId')
    expect(fieldNames).toContain('clientName')
    expect(fieldNames).toContain('redirectUris')
    expect(fieldNames).toContain('grantTypes')
    expect(fieldNames).toContain('responseTypes')
    expect(fieldNames).toContain('tokenEndpointAuthMethod')
    expect(fieldNames).toContain('softwareId')
    expect(fieldNames).toContain('softwareVersion')
    expect(fieldNames).toContain('isActive')
    expect(fieldNames).toContain('lastUsedAt')
  })

  it('marks clientId as required, unique, and indexed', () => {
    const field = oauthClientsCollection.fields.find(
      (f): f is Extract<typeof f, { name: string }> => 'name' in f && f.name === 'clientId',
    )
    expect(field).toBeDefined()
    expect(field?.required).toBe(true)
    expect(field?.unique).toBe(true)
    expect(field?.index).toBe(true)
  })

  it('marks redirectUris as required with minRows', () => {
    const field = oauthClientsCollection.fields.find(
      (f): f is Extract<typeof f, { name: string; type: string }> =>
        'name' in f && f.name === 'redirectUris',
    ) as { required?: boolean; minRows?: number } | undefined
    expect(field?.required).toBe(true)
    expect(field?.minRows).toBe(1)
  })

  it('defaults isActive to true', () => {
    const field = oauthClientsCollection.fields.find(
      (f): f is Extract<typeof f, { name: string }> => 'name' in f && f.name === 'isActive',
    ) as { defaultValue?: unknown } | undefined
    expect(field?.defaultValue).toBe(true)
  })

  it('has access control functions', () => {
    expect(typeof oauthClientsCollection.access?.create).toBe('function')
    expect(typeof oauthClientsCollection.access?.read).toBe('function')
    expect(typeof oauthClientsCollection.access?.update).toBe('function')
    expect(typeof oauthClientsCollection.access?.delete).toBe('function')
  })

  it('denies ALL public REST/GraphQL access, even to authenticated users (server-managed only)', () => {
    const access = oauthClientsCollection.access
    // Even an authenticated user must be denied: these rows are only touched
    // server-side via overrideAccess / the Local API. (A previous bug allowed
    // any authenticated user to rewrite client redirectUris → auth-code theft.)
    const ctx = { req: { user: { id: '1', collection: 'users' } } } as never
    for (const op of ['create', 'read', 'update', 'delete'] as const) {
      const fn = access?.[op]
      if (typeof fn !== 'function') throw new Error(`${op} is not a function`)
      expect(fn(ctx), `${op} must be denied`).toBe(false)
    }
  })

  it('has timestamps enabled', () => {
    expect(oauthClientsCollection.timestamps).toBe(true)
  })
})
