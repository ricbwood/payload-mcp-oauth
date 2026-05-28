import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { payloadMcp } from '@payloadcms/plugin-mcp'
import path from 'path'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'
import sharp from 'sharp'

// TODO T5.2: import { payloadMcpOAuth } from '@brainweb/payload-plugin-mcp-oauth'
// Remove this comment and enable the import once packages/plugin/src/index.ts is built
// per PROJECT_PLAN.md §5 (Plugin wiring). Plugin must be registered AFTER payloadMcp().

import { Users } from './collections/Users'
import { Media } from './collections/Media'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

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
    },
  }),
  sharp,
  plugins: [
    payloadMcp({}),
    // TODO T5.2: payloadMcpOAuth({ issuer: process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000' }),
  ],
})
