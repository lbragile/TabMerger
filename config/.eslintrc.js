module.exports = {
  env: {
    browser: true,
    es6: true,
    webextensions: true,
  },
  extends: ["react-app", "react-app/jest"],
  parser: "@typescript-eslint/parser",
  parserOptions: { ecmaVersion: 2018 },
  plugins: ["react", "@typescript-eslint"],
  rules: {},
  ignorePatterns: ["docs/**/*", "tests/**/*"],
};
