// @ts-check
import tseslint from 'typescript-eslint';

// Time, randomness, scheduling and network access must come from the injected ports
// (src/core/ports.ts) so tests are deterministic and offline (NFR5.1-NFR5.3).
const portRestrictions = {
  'no-restricted-globals': [
    'error',
    { name: 'setTimeout', message: 'Use the injected Scheduler (src/core/ports.ts).' },
    { name: 'setInterval', message: 'Use the injected Scheduler (src/core/ports.ts).' },
    { name: 'setImmediate', message: 'Use the injected Scheduler (src/core/ports.ts).' },
    { name: 'clearTimeout', message: 'Use the injected Scheduler (src/core/ports.ts).' },
    { name: 'clearInterval', message: 'Use the injected Scheduler (src/core/ports.ts).' },
    { name: 'fetch', message: 'Use the injected Net port (src/core/ports.ts).' },
  ],
  'no-restricted-properties': [
    'error',
    { object: 'Date', property: 'now', message: 'Use the injected Clock (src/core/ports.ts).' },
    {
      object: 'Math',
      property: 'random',
      message: 'Use the injected Rng (src/core/ports.ts).',
    },
    {
      object: 'globalThis',
      property: 'fetch',
      message: 'Use the injected Net port (src/core/ports.ts).',
    },
  ],
  'no-restricted-syntax': [
    'error',
    {
      selector: "NewExpression[callee.name='Date'][arguments.length=0]",
      message: 'Use the injected Clock (src/core/ports.ts); new Date() reads the real clock.',
    },
    {
      selector:
        'ImportSpecifier[imported.name=/^(randomBytes|randomUUID|randomInt|randomFillSync|getRandomValues)$/]',
      message: 'Use the injected Rng (src/core/ports.ts).',
    },
    {
      selector: 'ImportSpecifier[imported.name=/^(setTimeout|setInterval|setImmediate)$/]',
      message: 'Use the injected Scheduler (src/core/ports.ts).',
    },
  ],
};

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**', 'audit/**', 'aidlc/**', '.claude/**'] },
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      ...portRestrictions,
      // Standard output carries the MCP protocol only; use the Logger (standard error).
      'no-console': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      eqeqeq: 'error',
    },
  },
  {
    // The only module allowed to touch real time, randomness, timers and the network.
    files: ['src/core/ports.ts'],
    rules: {
      'no-restricted-globals': 'off',
      'no-restricted-properties': 'off',
      'no-restricted-syntax': 'off',
    },
  },
  {
    // Entry points write to the terminal on purpose (approve prompts, walkthrough output).
    files: ['src/bin/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['eslint.config.js'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { parserOptions: { projectService: false } },
  },
);
