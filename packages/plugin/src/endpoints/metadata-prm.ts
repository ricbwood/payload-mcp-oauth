import type { PayloadHandler } from 'payload'
import { jsonResponse } from './helpers.js'

export interface PrmMetadata {
  resource: string
  authorization_servers: [string]
  bearer_methods_supported: ['header']
  resource_documentation?: string
}

export function buildPrmMetadata(baseUrl: string): PrmMetadata {
  const base = baseUrl.replace(/\/$/, '')
  return {
    resource: base,
    authorization_servers: [base],
    bearer_methods_supported: ['header'],
  }
}

export function makePrmMetadataHandler(issuer: string): PayloadHandler {
  const metadata = buildPrmMetadata(issuer)
  return () =>
    jsonResponse(metadata, 200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET',
    })
}
