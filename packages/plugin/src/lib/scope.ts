import type { MCPPluginConfig } from '@payloadcms/plugin-mcp'

export function toCamelCase(str: string): string {
  return str
    .replace(/[-_\s]+(.)?/g, (_, chr: string) => (chr ? chr.toUpperCase() : ''))
    .replace(/^(.)/, (_, chr: string) => chr.toLowerCase())
}

/**
 * Derives the full set of MCP capabilities enabled by the operator.
 * Used for empty-scope tokens (full grant) and as the fallback in wrap-mcp for v1 tokens.
 */
export function buildFullCapabilities(mcpPluginOptions: MCPPluginConfig): Record<string, unknown> {
  const caps: Record<string, unknown> = {}

  for (const [slug, cfg] of Object.entries(mcpPluginOptions.collections ?? {})) {
    if (!cfg) continue
    const key = toCamelCase(slug)
    if (cfg.enabled === true) {
      caps[key] = { find: true, create: true, update: true, delete: true }
    } else if (typeof cfg.enabled === 'object' && cfg.enabled !== null) {
      caps[key] = { ...cfg.enabled }
    }
  }

  for (const [slug, cfg] of Object.entries(mcpPluginOptions.globals ?? {})) {
    if (!cfg) continue
    const key = toCamelCase(slug)
    if (cfg.enabled === true) {
      caps[key] = { find: true, update: true }
    } else if (typeof cfg.enabled === 'object' && cfg.enabled !== null) {
      caps[key] = { ...cfg.enabled }
    }
  }

  return caps
}

export interface ScopeResult {
  valid: boolean
  invalidScopes: string[]
  capabilities: Record<string, unknown>
}

/**
 * Maps an OAuth scope string to narrowed MCP capabilities.
 *
 * Scope token format: "<collectionSlug>:<op>" or "<globalSlug>:<op>"
 *   read   → { find: true }
 *   write  → collections: { create: true, update: true }; globals: { update: true }
 *   delete → collections only: { delete: true }
 *
 * All requested operations must be enabled on the server — no partial grants.
 * An unknown slug, unknown operation, or disabled operation returns invalid_scope.
 *
 * Empty/absent scope returns valid=true with empty capabilities so the caller
 * (or the wrap-mcp fallback) applies the full operator grant.
 */
export function scopeToCapabilities(
  scope: string,
  mcpPluginOptions: MCPPluginConfig,
): ScopeResult {
  const tokens = scope.trim().split(/\s+/).filter(Boolean)

  if (tokens.length === 0) {
    return { valid: true, invalidScopes: [], capabilities: {} }
  }

  const invalidScopes: string[] = []
  const capabilities: Record<string, Record<string, boolean>> = {}

  for (const token of tokens) {
    const colon = token.indexOf(':')
    if (colon <= 0 || colon === token.length - 1) {
      invalidScopes.push(token)
      continue
    }

    const slug = token.slice(0, colon)
    const op = token.slice(colon + 1)
    const key = toCamelCase(slug)

    // Try collection
    const colCfg = mcpPluginOptions.collections?.[slug]
    if (colCfg?.enabled) {
      const enabledOps: Record<string, boolean> =
        colCfg.enabled === true
          ? { find: true, create: true, update: true, delete: true }
          : (colCfg.enabled as Record<string, boolean>)
      const requestedOps = collectionOpsFor(op)
      if (!requestedOps) {
        invalidScopes.push(token)
        continue
      }
      // All requested ops must be enabled (no partial widening)
      if (!Object.entries(requestedOps).every(([k, v]) => !v || enabledOps[k])) {
        invalidScopes.push(token)
        continue
      }
      capabilities[key] = { ...(capabilities[key] ?? {}), ...requestedOps }
      continue
    }

    // Try global
    const globCfg = mcpPluginOptions.globals?.[slug]
    if (globCfg?.enabled) {
      const enabledOps: Record<string, boolean> =
        globCfg.enabled === true
          ? { find: true, update: true }
          : (globCfg.enabled as Record<string, boolean>)
      const requestedOps = globalOpsFor(op)
      if (!requestedOps) {
        invalidScopes.push(token)
        continue
      }
      if (!Object.entries(requestedOps).every(([k, v]) => !v || enabledOps[k])) {
        invalidScopes.push(token)
        continue
      }
      capabilities[key] = { ...(capabilities[key] ?? {}), ...requestedOps }
      continue
    }

    invalidScopes.push(token)
  }

  if (invalidScopes.length > 0) {
    return { valid: false, invalidScopes, capabilities: {} }
  }
  return { valid: true, invalidScopes: [], capabilities: capabilities as Record<string, unknown> }
}

function collectionOpsFor(op: string): Record<string, boolean> | null {
  if (op === 'read') return { find: true }
  if (op === 'write') return { create: true, update: true }
  if (op === 'delete') return { delete: true }
  return null
}

function globalOpsFor(op: string): Record<string, boolean> | null {
  if (op === 'read') return { find: true }
  if (op === 'write') return { update: true }
  return null
}
