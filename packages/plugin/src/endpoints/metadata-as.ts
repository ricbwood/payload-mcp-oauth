import type { PayloadHandler } from 'payload'
import { jsonResponse } from './helpers.js'

export interface AsMetadata {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  registration_endpoint: string
  revocation_endpoint: string
  response_types_supported: ['code']
  grant_types_supported: ['authorization_code', 'refresh_token']
  code_challenge_methods_supported: ['S256']
  token_endpoint_auth_methods_supported: ['none']
}

export function buildAsMetadata(baseUrl: string): AsMetadata {
  const base = baseUrl.replace(/\/$/, '')
  return {
    issuer: base,
    authorization_endpoint: `${base}/api/oauth/authorize`,
    token_endpoint: `${base}/api/oauth/token`,
    registration_endpoint: `${base}/api/oauth/register`,
    revocation_endpoint: `${base}/api/oauth/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
  }
}

export function makeAsMetadataHandler(issuer: string): PayloadHandler {
  const metadata = buildAsMetadata(issuer)
  return () =>
    jsonResponse(metadata, 200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET',
    })
}
