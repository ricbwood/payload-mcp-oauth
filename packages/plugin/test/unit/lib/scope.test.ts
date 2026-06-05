import { describe, expect, it } from 'vitest'
import { toCamelCase, buildFullCapabilities, scopeToCapabilities } from '../../../src/lib/scope.js'
import type { MCPPluginConfig } from '@payloadcms/plugin-mcp'

const MCP_OPTIONS: MCPPluginConfig = {
  collections: {
    posts: { enabled: true },
    media: { enabled: { find: true, create: true } as never },
    'read-only': { enabled: { find: true } as never },
    'blog-posts': { enabled: true },
  },
  globals: {
    settings: { enabled: true },
    'site-config': { enabled: { find: true } as never },
  },
}

describe('toCamelCase', () => {
  it('leaves simple slugs unchanged', () => {
    expect(toCamelCase('posts')).toBe('posts')
  })

  it('converts hyphenated slugs to camelCase', () => {
    expect(toCamelCase('blog-posts')).toBe('blogPosts')
    expect(toCamelCase('site-config')).toBe('siteConfig')
  })
})

describe('buildFullCapabilities', () => {
  it('grants full ops for collections with enabled: true', () => {
    const caps = buildFullCapabilities(MCP_OPTIONS)
    expect(caps['posts']).toEqual({ find: true, create: true, update: true, delete: true })
  })

  it('spreads partial object capabilities for collections', () => {
    const caps = buildFullCapabilities(MCP_OPTIONS)
    expect(caps['media']).toEqual({ find: true, create: true })
  })

  it('grants full ops for globals with enabled: true', () => {
    const caps = buildFullCapabilities(MCP_OPTIONS)
    expect(caps['settings']).toEqual({ find: true, update: true })
  })

  it('uses camelCase key for hyphenated slugs', () => {
    const caps = buildFullCapabilities(MCP_OPTIONS)
    expect(caps['blogPosts']).toEqual({ find: true, create: true, update: true, delete: true })
  })

  it('ignores nullish or missing entries', () => {
    const caps = buildFullCapabilities({ collections: { absent: null as never } })
    expect(caps['absent']).toBeUndefined()
  })
})

describe('scopeToCapabilities — empty scope', () => {
  it('returns valid with empty capabilities for empty string (full-grant fallback)', () => {
    const r = scopeToCapabilities('', MCP_OPTIONS)
    expect(r.valid).toBe(true)
    expect(r.invalidScopes).toEqual([])
    expect(r.capabilities).toEqual({})
  })

  it('returns valid with empty capabilities for whitespace-only scope', () => {
    expect(scopeToCapabilities('   ', MCP_OPTIONS).valid).toBe(true)
  })
})

describe('scopeToCapabilities — collection scopes', () => {
  it('maps <slug>:read → { find: true }', () => {
    const r = scopeToCapabilities('posts:read', MCP_OPTIONS)
    expect(r.valid).toBe(true)
    expect(r.capabilities['posts']).toEqual({ find: true })
  })

  it('maps <slug>:write → { create: true, update: true }', () => {
    const r = scopeToCapabilities('posts:write', MCP_OPTIONS)
    expect(r.valid).toBe(true)
    expect(r.capabilities['posts']).toEqual({ create: true, update: true })
  })

  it('maps <slug>:delete → { delete: true }', () => {
    const r = scopeToCapabilities('posts:delete', MCP_OPTIONS)
    expect(r.valid).toBe(true)
    expect(r.capabilities['posts']).toEqual({ delete: true })
  })

  it('rejects write when any required op is not enabled (no partial widening)', () => {
    // media has find+create only; write needs create+update — update not enabled
    const r = scopeToCapabilities('media:write', MCP_OPTIONS)
    expect(r.valid).toBe(false)
    expect(r.invalidScopes).toContain('media:write')
    expect(r.capabilities).toEqual({})
  })

  it('accepts write when all required ops are enabled', () => {
    // posts has all ops enabled
    const r = scopeToCapabilities('posts:write', MCP_OPTIONS)
    expect(r.valid).toBe(true)
  })

  it('rejects write for a read-only collection (no create/update)', () => {
    const r = scopeToCapabilities('read-only:write', MCP_OPTIONS)
    expect(r.valid).toBe(false)
  })

  it('converts hyphenated slug to camelCase key', () => {
    const r = scopeToCapabilities('blog-posts:read', MCP_OPTIONS)
    expect(r.valid).toBe(true)
    expect(r.capabilities['blogPosts']).toEqual({ find: true })
  })
})

describe('scopeToCapabilities — global scopes', () => {
  it('maps global <slug>:read → { find: true }', () => {
    const r = scopeToCapabilities('settings:read', MCP_OPTIONS)
    expect(r.valid).toBe(true)
    expect(r.capabilities['settings']).toEqual({ find: true })
  })

  it('maps global <slug>:write → { update: true }', () => {
    const r = scopeToCapabilities('settings:write', MCP_OPTIONS)
    expect(r.valid).toBe(true)
    expect(r.capabilities['settings']).toEqual({ update: true })
  })

  it('rejects delete for globals (no delete operation)', () => {
    const r = scopeToCapabilities('settings:delete', MCP_OPTIONS)
    expect(r.valid).toBe(false)
    expect(r.invalidScopes).toContain('settings:delete')
  })

  it('rejects when op is not enabled for a partial global', () => {
    // site-config has only find enabled; write needs update which is not enabled
    const r = scopeToCapabilities('site-config:write', MCP_OPTIONS)
    expect(r.valid).toBe(false)
  })
})

describe('scopeToCapabilities — multi-token scopes', () => {
  it('combines capabilities across multiple tokens for the same slug', () => {
    const r = scopeToCapabilities('posts:read posts:delete', MCP_OPTIONS)
    expect(r.valid).toBe(true)
    expect(r.capabilities['posts']).toEqual({ find: true, delete: true })
  })

  it('combines capabilities across different slugs', () => {
    const r = scopeToCapabilities('posts:read settings:write', MCP_OPTIONS)
    expect(r.valid).toBe(true)
    expect(r.capabilities['posts']).toEqual({ find: true })
    expect(r.capabilities['settings']).toEqual({ update: true })
  })

  it('fails the entire result when any token is invalid', () => {
    const r = scopeToCapabilities('posts:read unknown:read', MCP_OPTIONS)
    expect(r.valid).toBe(false)
    expect(r.invalidScopes).toContain('unknown:read')
    // No partial capabilities leaked — the entire grant is rejected
    expect(r.capabilities).toEqual({})
  })
})

describe('scopeToCapabilities — invalid tokens', () => {
  it('rejects tokens without a colon separator', () => {
    expect(scopeToCapabilities('openid', MCP_OPTIONS).valid).toBe(false)
    expect(scopeToCapabilities('mcp', MCP_OPTIONS).valid).toBe(false)
  })

  it('rejects tokens with a trailing colon (empty operation)', () => {
    expect(scopeToCapabilities('posts:', MCP_OPTIONS).valid).toBe(false)
  })

  it('rejects tokens with a leading colon (empty slug)', () => {
    expect(scopeToCapabilities(':read', MCP_OPTIONS).valid).toBe(false)
  })

  it('rejects an unknown collection slug', () => {
    expect(scopeToCapabilities('nonexistent:read', MCP_OPTIONS).valid).toBe(false)
  })

  it('rejects an unknown operation', () => {
    expect(scopeToCapabilities('posts:list', MCP_OPTIONS).valid).toBe(false)
    expect(scopeToCapabilities('posts:admin', MCP_OPTIONS).valid).toBe(false)
  })

  it('never widens: invalid scope always returns empty capabilities', () => {
    // Even if some tokens were valid, a single invalid token nullifies the entire result
    const r = scopeToCapabilities('posts:read evil:all', MCP_OPTIONS)
    expect(r.valid).toBe(false)
    expect(r.capabilities).toEqual({})
  })
})
