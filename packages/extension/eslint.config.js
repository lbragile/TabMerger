// @ts-check
import tsParser from '@typescript-eslint/parser'
import tsPlugin from '@typescript-eslint/eslint-plugin'
import reactPlugin from 'eslint-plugin-react'
import reactHooksPlugin from 'eslint-plugin-react-hooks'

// UI copy must come from the message catalog (src/locales/en.yml via src/lib/i18n.ts), so a new
// language is a catalog drop-in. These catch the common ways a hardcoded string slips in.
// Symbols and punctuation only (no letters) are allowed as bare JSX text.
const COPY_SYMBOLS = ['·', '—', '–', '×', '/', '…', '•', '(', ')', ':', '+', '-', '|', '%', '↑↓', '↵', '→', '←', '↑', '↓', ',', '.', '?', '!', '#', '"', '&', '·…', '◆']
/** Attributes whose value a user reads or hears. */
const COPY_ATTRIBUTES = '^(aria-label|aria-description|aria-roledescription|aria-valuetext|title|placeholder|alt|label|description|tooltip)$'
const LETTERS = '/[A-Za-z]/'

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    ignores: ['.wxt/**', '.output/**', 'node_modules/**', 'src/__tests__/**'],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: {
      '@typescript-eslint': tsPlugin,
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
    },
    languageOptions: {
      parser: tsParser,
      parserOptions: { project: './tsconfig.json' },
    },
    rules: {
      // TypeScript — essential checks only
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-empty-object-type': 'off',
      // React — avoid JSX footguns
      'react/react-in-jsx-scope': 'off',
      'react/no-unescaped-entities': 'off',
      'react/display-name': 'off',
      'react/no-children-prop': 'error',
      // React hooks — only the rules that were in v4
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
    settings: { react: { version: 'detect' } },
  },
  {
    // Every UI path. Not src/components/ui (unmodified shadcn primitives), the dev-only mocks,
    // or the demo seed data (lib/demoData.ts: recorded marketing content, not app copy).
    files: ['src/components/**/*.tsx', 'src/entrypoints/**/*.{ts,tsx}', 'src/hooks/**/*.{ts,tsx}', 'src/lib/**/*.{ts,tsx}'],
    ignores: ['src/components/ui/**', 'src/mocks/**', 'src/lib/demoData.ts'],
    rules: {
      'react/jsx-no-literals': ['error', { noStrings: false, allowedStrings: COPY_SYMBOLS, ignoreProps: true }],
      'no-restricted-syntax': [
        'error',
        {
          selector: `JSXAttribute[name.name=/${COPY_ATTRIBUTES}/] > Literal[value=${LETTERS}]`,
          message: 'User-facing attribute text must come from the catalog: t("area.key") from @/lib/i18n.',
        },
        {
          selector: `JSXAttribute[name.name=/${COPY_ATTRIBUTES}/] > JSXExpressionContainer > Literal[value=${LETTERS}]`,
          message: 'User-facing attribute text must come from the catalog: t("area.key") from @/lib/i18n.',
        },
        {
          selector: `CallExpression[callee.object.name='toast'] > Literal[value=${LETTERS}]`,
          message: 'Toast text must come from the catalog: t("area.key") from @/lib/i18n.',
        },
        {
          selector: `CallExpression[callee.object.name='toast'] > TemplateLiteral`,
          message: 'Toast text must come from the catalog: t("area.key", { value }) from @/lib/i18n.',
        },
        {
          // n === 1 ? '' : 's' and friends: English-only plurals
          selector: `ConditionalExpression[consequent.value=''][alternate.value='s'], ConditionalExpression[consequent.value='s'][alternate.value='']`,
          message: 'Plurals come from the catalog: t("area.key", { count }) with key_one / key_other.',
        },
      ],
    },
  },
]
