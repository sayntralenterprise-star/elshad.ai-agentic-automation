import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/node_modules/**',
      'python/**',
      '.dependency-cruiser.cjs',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ExportDefaultDeclaration',
          message: 'Default exports are forbidden except in route page modules (L.3).',
        },
      ],
    },
  },
  {
    files: [
      'apps/console/src/routes/**/*.tsx',
      '**/*.config.{js,ts,mjs,cjs}',
      'eslint.config.js',
    ],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
);
