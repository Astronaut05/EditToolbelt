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
    // Model and ONNX Runtime files fetched by `pnpm models` (git-ignored).
    '**/public/models/',
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
  // crash on ESLint 10, and ESLint 9 is end-of-life (2026-08-06), so no going back.
  // TODO(M1, tracked in docs/12-milestones.md): re-add Next's full preset and the
  // React, jsx-a11y and import plugins once each supports ESLint 10. Until then
  // axe in Playwright is the accessibility gate.
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
