import tseslint from 'typescript-eslint'
import security from 'eslint-plugin-security'

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'examples/**'] },
  ...tseslint.configs.recommended,
  security.configs.recommended,
)
