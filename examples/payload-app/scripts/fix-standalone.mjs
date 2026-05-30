/**
 * Firebase App Hosting's Next.js adapter expects the standalone output at
 *   .next/standalone/.next/routes-manifest.json
 *
 * But when building in a pnpm workspace, Next.js nests the output under the
 * package's path relative to the workspace root, e.g.:
 *   .next/standalone/examples/payload-app/.next/routes-manifest.json
 *
 * This script promotes the nested output to where Firebase expects it.
 */

import { cpSync, existsSync, copyFileSync, mkdirSync } from 'fs'
import { join } from 'path'

const standaloneDir = join(process.cwd(), '.next', 'standalone')
const nestedDir = join(standaloneDir, 'examples', 'payload-app')

if (!existsSync(nestedDir)) {
  // Already in the right place or structure is different — nothing to do.
  process.exit(0)
}

if (existsSync(join(nestedDir, '.next'))) {
  cpSync(join(nestedDir, '.next'), join(standaloneDir, '.next'), { recursive: true })
}

if (existsSync(join(nestedDir, 'server.js'))) {
  copyFileSync(join(nestedDir, 'server.js'), join(standaloneDir, 'server.js'))
}

if (existsSync(join(nestedDir, 'package.json'))) {
  copyFileSync(join(nestedDir, 'package.json'), join(standaloneDir, 'package.json'))
}

console.log('[fix-standalone] Promoted standalone output to .next/standalone/')
