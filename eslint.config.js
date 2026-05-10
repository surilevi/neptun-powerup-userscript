// @ts-check

import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'
import globals from 'globals'

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
    },
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2021,
        GM: 'readonly',
      },
    },
  },
  {
    ignores: ['dist/', 'node_modules/', '*.config.*'],
  },
)
