// One flat config for the whole JS/TS side. Each workspace package runs
// `eslint .`, which finds this file by walking up from its directory.
import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import prettier from 'eslint-config-prettier/flat';
import reactHooks from 'eslint-plugin-react-hooks';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores([
    '**/node_modules/',
    '**/.next/',
    '**/out/',
    '**/.turbo/',
    '**/next-env.d.ts',
    'apps/worker/',
  ]),

  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Allow numbers in template strings (sizes, durations); keep the rest strict.
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },

  // eslint-config-next isn't used: eslint-plugin-react, -import and -jsx-a11y
  // don't support ESLint 10 yet. The Next and React Hooks plugins do.
  // TODO(M1): add jsx-a11y (or an equivalent) once it supports ESLint 10;
  // until then axe in Playwright covers accessibility.
  {
    files: ['apps/web/**/*.{ts,tsx}', 'packages/ui/**/*.{ts,tsx}'],
    extends: [nextPlugin.configs['core-web-vitals'], reactHooks.configs.flat['recommended-latest']],
    rules: {
      // App Router only (no pages/ dir). Plain <a> is also required on purpose
      // for links into and out of COOP/COEP routes (docs/01 → Cross-origin isolation).
      '@next/next/no-html-link-for-pages': 'off',
    },
  },

  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
  },

  prettier,
);
