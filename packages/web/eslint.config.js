// @ts-check
const nextConfig = require('eslint-config-next')

/**
 * Text a translated component may still write literally: punctuation and symbols, the brand and
 * product names, and browser names that read the same in every language. Everything else comes
 * from the message catalog (messages/en.json, see docs/I18N.md).
 */
const ALLOWED_LITERALS = [
  'TabMerger', 'GitHub', 'Chrome', 'Firefox', 'Edge',
  '·', ' · ', '—', ' — ', '→', '←', '…', '+', '−', '-', '/', ':', '.', ',', '(', ')', '?', '!', '%', '#', '|',
  '✕', '☰', '★', '☆', '✦', '✓', '⋯', '"', '“', '”', '‘', '’', '©', '&#9670;',
  // The address bar in the error pages' illustration.
  'tabmerger.com/…',
]

/** Files whose words must come from the catalog. */
const TRANSLATED_FILES = [
  'app/[[]locale[]]/**/*.tsx',
  'app/not-found.tsx',
  'app/error.tsx',
  'app/global-error.tsx',
  'components/**/*.tsx',
]

/**
 * English-only by design: the binding legal text (Privacy, Terms and their contents list), the
 * sign-in pages outside the translated site, and tests.
 */
const UNTRANSLATED_FILES = [
  'app/[[]locale[]]/(marketing)/privacy/**',
  'app/[[]locale[]]/(marketing)/terms/**',
  'components/legal-toc.tsx',
  'components/auth/**',
  '**/*.test.tsx',
  '**/__tests__/**',
]

/** User-facing attributes; an English word written into one is a missed translation. */
const TEXT_ATTRIBUTES = 'aria-label|aria-roledescription|aria-valuetext|title|alt|placeholder'

/** @type {import('eslint').Linter.Config[]} */
module.exports = [
  ...nextConfig,
  {
    rules: {
      // ponytail: noisy for content/legal pages with prose text
      'react/no-unescaped-entities': 'off',
    },
  },
  {
    files: TRANSLATED_FILES,
    ignores: UNTRANSLATED_FILES,
    rules: {
      // Words in JSX text, or in `{'…'}` / `{`…`}` children, must come from `t()`.
      'react/jsx-no-literals': ['error', { noStrings: true, ignoreProps: true, allowedStrings: ALLOWED_LITERALS }],
      'no-restricted-syntax': [
        'error',
        {
          selector: `JSXAttribute[name.name=/^(${TEXT_ATTRIBUTES})$/] > Literal[value=/^(?!TabMerger$|GitHub$|Chrome$|Firefox$|Edge$).*[A-Za-z]/]`,
          message: 'User-facing attribute text must come from the message catalog (t()). See docs/I18N.md.',
        },
      ],
    },
  },
]
