import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { mcpPlugin } from '@payloadcms/plugin-mcp'
import type { MCPPluginConfig } from '@payloadcms/plugin-mcp'
import { payloadMcpOAuth } from '@brainwebuk/payload-plugin-mcp-oauth'
import path from 'path'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'
import sharp from 'sharp'

import { Users } from './collections/Users'
import { Media } from './collections/Media'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

const mcpOptions: MCPPluginConfig = {
  collections: {
    users: {
      enabled: { find: true, create: false, update: true, delete: false },
    },
    media: {
      enabled: { find: true, create: true, update: false, delete: false },
    },
  },
}

// Disable the MCP layer the way a real consumer would: set `disabled` on the
// SHARED mcpOptions object so BOTH mcpPlugin and payloadMcpOAuth (which reads
// this same reference) observe it — payloadMcpOAuth then becomes a no-op instead
// of throwing PLUGIN_ORDER when @payloadcms/plugin-mcp doesn't register /mcp.
// Env-gated and off by default; the install-test disabled matrix flips it to
// assert a clean boot (the 0.3.3 crash path — issue #43).
if (process.env.PMOAUTH_TEST_MCP_DISABLED === '1') mcpOptions.disabled = true

export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
  },
  collections: [Users, Media],
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET || '',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: sqliteAdapter({
    client: {
      url: process.env.DATABASE_URL || '',
      authToken: process.env.TURSO_AUTH_TOKEN,
    },
  }),
  sharp,
  plugins: [
    mcpPlugin(mcpOptions),
    // Env-gated for the install-test incremental-install probe: omit the OAuth
    // plugin entirely so a first boot pushes a DB WITHOUT the OAuth collections,
    // then a second boot WITH the plugin exercises adding them onto an existing
    // DB — the 0.3.2 `no such column: oauth_clients_id` locked-documents rebuild
    // path. Off by default (issue #43).
    ...(process.env.PMOAUTH_TEST_OAUTH_OMITTED === '1'
      ? []
      : [
          payloadMcpOAuth({
            issuer: process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000',
            mcpPluginOptions: mcpOptions,
            // Env-gated for the install-test disabled matrix: the OAuth layer must
            // be a clean no-op (keeps its collections, adds no endpoints) when
            // disabled.
            ...(process.env.PMOAUTH_TEST_OAUTH_DISABLED === '1' ? { disabled: true } : {}),
          }),
        ]),
  ],
})
