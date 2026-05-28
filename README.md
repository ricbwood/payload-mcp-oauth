# Install everything across the workspace, once. Generates a single
# pnpm-lock.yaml at the root.
pnpm install

# Run a script in every package that defines it.
pnpm -r test
pnpm -r build

# Target one package by directory.
pnpm --filter ./packages/plugin build
pnpm --filter ./examples/payload-app dev

# Target one package by name.
pnpm --filter @brainweb/payload-plugin-mcp-oauth typecheck

# Add a dep to a specific package — never the root, unless you mean to.
pnpm --filter ./packages/plugin add zod
pnpm --filter ./packages/plugin add -D vitest

# Add a dep meant for everyone (rare — usually only toolchain stuff).
pnpm add -Dw prettier