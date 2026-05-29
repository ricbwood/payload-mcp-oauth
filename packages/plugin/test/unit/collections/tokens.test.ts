import { describe, expect, it } from 'vitest'
import { oauthTokensCollection } from '../../../src/collections/tokens.js'

describe('oauthTokensCollection', () => {
  it('has the correct slug', () => {
    expect(oauthTokensCollection.slug).toBe('oauth-tokens')
  })

  it('has all required fields', () => {
    const fieldNames = oauthTokensCollection.fields
      .filter((f): f is Extract<typeof f, { name: string }> => 'name' in f)
      .map((f) => f.name)

    expect(fieldNames).toContain('tokenHash')
    expect(fieldNames).toContain('tokenType')
    expect(fieldNames).toContain('clientId')
    expect(fieldNames).toContain('userId')
    expect(fieldNames).toContain('scope')
    expect(fieldNames).toContain('capabilities')
    expect(fieldNames).toContain('expiresAt')
    expect(fieldNames).toContain('revokedAt')
    expect(fieldNames).toContain('lastUsedAt')
    expect(fieldNames).toContain('parentTokenId')
  })

  it('marks tokenHash as required, unique, and indexed', () => {
    const field = oauthTokensCollection.fields.find(
      (f): f is Extract<typeof f, { name: string }> => 'name' in f && f.name === 'tokenHash',
    )
    expect(field?.required).toBe(true)
    expect(field?.unique).toBe(true)
    expect(field?.index).toBe(true)
  })

  it('marks lookup fields as indexed', () => {
    const indexedFields = ['tokenType', 'clientId', 'userId', 'expiresAt', 'revokedAt', 'parentTokenId']
    indexedFields.forEach((name) => {
      const field = oauthTokensCollection.fields.find(
        (f): f is Extract<typeof f, { name: string }> => 'name' in f && f.name === name,
      )
      expect(field?.index, `${name} should be indexed`).toBe(true)
    })
  })

  it('tokenType only allows access and refresh', () => {
    const field = oauthTokensCollection.fields.find(
      (f): f is Extract<typeof f, { name: string }> => 'name' in f && f.name === 'tokenType',
    ) as { options?: Array<{ value: string }> } | undefined
    const values = field?.options?.map((o) => o.value)
    expect(values).toEqual(['access', 'refresh'])
  })

  it('stores capabilities as json', () => {
    const field = oauthTokensCollection.fields.find(
      (f): f is Extract<typeof f, { name: string; type: string }> =>
        'name' in f && f.name === 'capabilities',
    )
    expect(field?.type).toBe('json')
  })

  it('has a cascade revocation afterChange hook', () => {
    expect(oauthTokensCollection.hooks?.afterChange?.length).toBeGreaterThan(0)
  })

  it('has access control functions', () => {
    expect(typeof oauthTokensCollection.access?.read).toBe('function')
    expect(typeof oauthTokensCollection.access?.update).toBe('function')
  })

  it('has timestamps disabled', () => {
    expect(oauthTokensCollection.timestamps).toBe(false)
  })
})
