import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/admin/index.ts', 'src/next-middleware.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
})
