import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

// core/ and ai/ must stay pure (ADR-0004): no rendering, DOM, storage or app-layer imports.
const impureImports = {
  patterns: [
    { group: ['pixi.js', 'pixi.js/*'], message: 'core/ and ai/ must not import rendering.' },
    {
      group: ['**/render/**', '**/ui/**', '**/app/**', '**/persistence/**'],
      message: 'core/ and ai/ must not depend on outer layers.',
    },
  ],
};

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'e2e/.results', 'playwright-report'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ['src/core/**/*.ts', 'src/ai/**/*.ts'],
    languageOptions: { globals: { ...globals['shared-node-browser'] } },
    rules: {
      'no-restricted-imports': ['error', impureImports],
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'core/ and ai/ must not touch the DOM.' },
        { name: 'document', message: 'core/ and ai/ must not touch the DOM.' },
        { name: 'indexedDB', message: 'core/ and ai/ must not touch storage.' },
        { name: 'localStorage', message: 'core/ and ai/ must not touch storage.' },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use the seeded RNG in GameState.' },
        { object: 'Date', property: 'now', message: 'core/ must be deterministic.' },
      ],
    },
  },
  {
    files: ['src/ai/worker.ts'],
    languageOptions: { globals: { ...globals.worker } },
  },
  {
    files: ['*.config.{js,ts}', 'e2e/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
);
