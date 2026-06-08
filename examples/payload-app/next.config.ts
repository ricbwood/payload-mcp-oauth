import { withPayload } from '@payloadcms/next/withPayload'
import type { NextConfig } from 'next'

// When served behind a public URL (test:install:serve --live sets
// PMOAUTH_PUBLIC_URL to the tunnel URL), allow that host as a dev origin so the
// Next dev server doesn't block cross-origin admin/asset requests coming through
// the tunnel. Unset on plain localhost → no effect.
let allowedDevOrigins: string[] | undefined
if (process.env.PMOAUTH_PUBLIC_URL) {
  try {
    allowedDevOrigins = [new URL(process.env.PMOAUTH_PUBLIC_URL).host]
  } catch {
    /* malformed URL — leave unset */
  }
}

const nextConfig: NextConfig = {
  output: 'standalone',
  ...(allowedDevOrigins ? { allowedDevOrigins } : {}),
  // The .well-known OAuth discovery rewrites are handled by the plugin's
  // exported handler wired up as a proxy (see src/proxy.ts), so no rewrites()
  // entry is needed here.
  images: {
    localPatterns: [
      {
        pathname: '/api/media/file/**',
      },
    ],
  },
  webpack: (webpackConfig) => {
    webpackConfig.resolve.extensionAlias = {
      '.cjs': ['.cts', '.cjs'],
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
    }

    return webpackConfig
  },
}

export default withPayload(nextConfig, { devBundleServerPackages: false })
