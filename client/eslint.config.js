import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'public/data', 'apps']),
  { files: ['scripts/**', 'vite.config.js'], languageOptions: { globals: globals.node } },
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    // Hooks and helpers live beside the components that use them; that costs only hot-reload granularity.
    // Data-fetching effects reset to a loading state when their input changes; that is the pattern this rule flags.
    rules: { 'react-refresh/only-export-components': 'off', 'react-hooks/set-state-in-effect': 'off' },
  },
])
