#!/usr/bin/env node
// Type-check the TS/TSX code blocks in our docs against the REAL installed types,
// so an example that doesn't compile — e.g. a config property at the wrong level,
// the `serverInfo`/`instructions`-at-top-level landmine that shipped in #57 and
// was fixed in #58 — fails CI instead of being copy-pasted by a consumer (or an
// install agent following INSTALL_FOR_AGENTS.md).
//
// Docs snippets are deliberately abbreviated (`// ...db, collections...`, vars
// defined "above"), so they don't fully compile in isolation. We therefore do NOT
// fail on the errors abbreviation causes — only on a curated high-signal set that
// means the example itself is WRONG (bad import path/name, unknown/misplaced
// object property, wrong call arity). Everything else (missing required property,
// undefined name) is ignored.
//
// Opt a block out entirely with the info string ```ts ignore``` or a leading
// `// @example-skip` line.
//
// Resolution: snippets are written into the example app, which already has the
// plugin (workspace), @payloadcms/plugin-mcp, payload and next on its module path,
// and type-checked with `tsc`. Build the plugin first so its dist .d.ts (incl. the
// `/middleware` and `/admin` subpaths) exist.

import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(here, '..')
const EXAMPLE_APP = path.join(REPO_ROOT, 'examples/payload-app')
const OUT_DIR = path.join(EXAMPLE_APP, '.doc-snippets')

const DOCS = ['README.md', 'packages/plugin/README.md', 'packages/plugin/INSTALL_FOR_AGENTS.md']

// Fail only on errors that mean the EXAMPLE is wrong, not merely abbreviated.
const FAIL_CODES = new Set([
  2307, // Cannot find module '…' (bad package path / subpath)
  2305, // Module '…' has no exported member '…' (wrong import name)
  2724, // '…' has no exported member named '…'. Did you mean '…'?
  2353, // Object literal may only specify known properties (the #58 class)
  2561, // …did you mean to write '…'? (excess-property variant)
  2554, // Expected N arguments, but got M
  2769, // No overload matches this call (wrong argument shape)
])

/** Pull fenced ts/tsx blocks out of a markdown string. */
function extractBlocks(md) {
  const blocks = []
  const re = /```(tsx?)([^\n]*)\n([\s\S]*?)```/g
  let m
  let n = 0
  while ((m = re.exec(md)) !== null) {
    n++
    const info = m[2].trim()
    const body = m[3]
    if (/\bignore\b/.test(info)) continue
    if (/^\s*\/\/\s*@example-skip/.test(body)) continue
    // Line number of the opening fence (for nicer reporting).
    const line = md.slice(0, m.index).split('\n').length
    blocks.push({ index: n, line, body, ext: m[1] === 'tsx' ? 'tsx' : 'ts' })
  }
  return blocks
}

function slug(docPath) {
  return docPath.replace(/[^a-z0-9]+/gi, '_')
}

// 1. Extract every checkable block and write it into the example app.
rmSync(OUT_DIR, { recursive: true, force: true })
mkdirSync(OUT_DIR, { recursive: true })

const fileToBlock = new Map()
let total = 0
for (const doc of DOCS) {
  const md = readFileSync(path.join(REPO_ROOT, doc), 'utf8')
  for (const b of extractBlocks(md)) {
    total++
    // `.tsx` for every block so JSX-bearing snippets are valid too.
    const fname = `${slug(doc)}__block${b.index}.tsx`
    writeFileSync(path.join(OUT_DIR, fname), b.body)
    fileToBlock.set(fname, { doc, ...b })
  }
}

// A tsconfig that extends the example's, includes only the snippets, and relaxes
// the rules abbreviation trips (unused imports, implicit returns, isolated modules).
writeFileSync(
  path.join(OUT_DIR, 'tsconfig.json'),
  JSON.stringify(
    {
      extends: '../tsconfig.json',
      compilerOptions: {
        noEmit: true,
        skipLibCheck: true,
        noUnusedLocals: false,
        noUnusedParameters: false,
        isolatedModules: false,
        types: [],
      },
      include: ['*.tsx'],
    },
    null,
    2,
  ),
)

console.log(`Type-checking ${total} doc code block(s) from:\n${DOCS.map((d) => `  • ${d}`).join('\n')}\n`)

// 2. Run tsc against just the snippets.
const tsc = spawnSync(
  path.join(EXAMPLE_APP, 'node_modules/.bin/tsc'),
  ['-p', path.join(OUT_DIR, 'tsconfig.json'), '--pretty', 'false'],
  { cwd: EXAMPLE_APP, encoding: 'utf8' },
)
const output = `${tsc.stdout ?? ''}${tsc.stderr ?? ''}`

// 3. Parse diagnostics: "<file>(line,col): error TS<code>: <msg>".
const diagRe = /^(.+?)\((\d+),(\d+)\):\s+error TS(\d+):\s+(.*)$/
const failures = []
for (const rawLine of output.split('\n')) {
  const d = rawLine.match(diagRe)
  if (!d) continue
  const code = Number(d[4])
  if (!FAIL_CODES.has(code)) continue
  const fname = path.basename(d[1])
  const origin = fileToBlock.get(fname)
  failures.push({
    doc: origin?.doc ?? d[1],
    block: origin?.index,
    docLine: origin ? origin.line + Number(d[2]) : undefined,
    code,
    msg: d[5],
  })
}

// 4. Report + clean up.
rmSync(OUT_DIR, { recursive: true, force: true })

if (failures.length === 0) {
  console.log(`✓ All ${total} doc code block(s) compile against the real types.`)
  process.exit(0)
}

console.log(`✗ ${failures.length} doc example error(s) — these examples don't match the real types:\n`)
for (const f of failures) {
  console.log(`  ${f.doc} (block ${f.block}, ~line ${f.docLine})\n      TS${f.code}: ${f.msg}`)
}
console.log('\nFix the example, or mark an intentionally-partial block with `// @example-skip` (or ```ts ignore```).')
process.exit(1)
