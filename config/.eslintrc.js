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
    "plugin:@typescript-eslint/recommended",
    "plugin:react-hooks/recommended",
  ],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaFeatures: { jsx: true },
    ecmaVersion: 12,
  },
  plugins: ["react", "@typescript-eslint"],
  rules: {
    "default-case": "warn",
  },
  settings: {
    react: {
      version: "detect",
    },
  },
  ignorePatterns: ["docs", "*.js"],
};
