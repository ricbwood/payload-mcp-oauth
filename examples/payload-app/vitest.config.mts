import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  // tsconfigPaths resolves the `@/` alias used by the integration test.
  plugins: [tsconfigPaths()],
  test: {
    // The integration test boots Payload via getPayload — no DOM needed.
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    include: ['tests/int/**/*.int.spec.ts'],
    // Booting Payload (schema push, sqlite) is slow on a cold run.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
})
