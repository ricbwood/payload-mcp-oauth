import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { mcpPlugin } from '@payloadcms/plugin-mcp'
import type { MCPPluginConfig } from '@payloadcms/plugin-mcp'
import { payloadMcpOAuth } from '@brainweb/payload-plugin-mcp-oauth'
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
    payloadMcpOAuth({
      issuer: process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000',
      mcpPluginOptions: mcpOptions,
    }),
  ],
})
