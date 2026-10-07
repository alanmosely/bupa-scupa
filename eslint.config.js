import js from '@eslint/js';

const globals = Object.fromEntries(
  [
    'process',
    'Buffer',
    'console',
    'URL',
    'URLSearchParams',
    'AbortController',
    'AbortSignal',
    'setTimeout',
    'clearTimeout',
    'setImmediate',
    'SharedArrayBuffer',
    'Atomics',
    'TextDecoder',
    'structuredClone',
    'window',
    'document',
    'DOMParser',
    'HTMLInputElement',
    'location',
    'fetch',
    'Option',
  ].map((name) => [name, 'readonly']),
);

export default [
  { ignores: ['node_modules/**', 'vendor/**', 'dist/**', '.cache/**', 'data/**', 'private/**'] },
  js.configs.recommended,
  {
    files: ['**/*.js', '**/*.cjs'],
    languageOptions: { ecmaVersion: 'latest', globals },
    rules: {
      'no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', caughtErrors: 'none', varsIgnorePattern: '^_' },
      ],
      'no-control-regex': 'off',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: { __dirname: 'readonly' } },
  },
];
