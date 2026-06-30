import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      'dist/',
      'coverage/',
      'node_modules/',
      'public/vendor/',
      'public/js/', // browser globals (htmx, Logger) - not part of the TS project
      'tests/',
      '**/*.config.{js,mjs,ts}',
    ],
  },
  {
    files: ['src/**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Enforce the conventions that were previously only prose:
      'no-console': 'error', // use the centralized Logger
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-floating-promises': 'error', // tsc can't catch these
      '@typescript-eslint/no-misused-promises': 'error',
      // Mirror tsconfig's noUnusedParameters: `_`-prefixed = intentionally unused.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // logger.ts IS the centralized console wrapper - the one place console is allowed.
    files: ['src/utils/logger.ts'],
    rules: { 'no-console': 'off' },
  },
  eslintConfigPrettier,
);
