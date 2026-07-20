// @ts-check
const nextConfig = require('eslint-config-next')

/** @type {import('eslint').Linter.Config[]} */
module.exports = [
  ...nextConfig,
  {
    rules: {
      // ponytail: noisy for content/legal pages with prose text
      'react/no-unescaped-entities': 'off',
    },
  },
]
