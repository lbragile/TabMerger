module.exports = {
  env: {
    browser: true,
    es6: true,
    commonjs: true,
    node: true,
    webextensions: true,
  },
  extends: [
    "eslint:recommended",
    "plugin:react/recommended",
    "plugin:react-hooks/recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:styled-components-a11y/recommended",
  ],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaFeatures: { jsx: true },
    ecmaVersion: 12,
  },
  plugins: ["react", "react-hooks", "@typescript-eslint", "styled-components-a11y"],
  rules: {
    "default-case": "warn",
    "@typescript-eslint/explicit-module-boundary-types": "off",
    "jsx-a11y/label-has-associated-control": ["error", { required: { some: ["nesting", "id"] } }],
    "jsx-a11y/label-has-for": ["error", { required: { some: ["nesting", "id"] } }],
    "react/jsx-uses-react": "off",
    "react/react-in-jsx-scope": "off",
  },
  settings: {
    react: {
      version: "detect",
    },
  },
  ignorePatterns: ["docs", "**/*.{js,jsx}"],
};
