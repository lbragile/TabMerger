module.exports = {
  moduleNameMapper: {
    "\\.(jpg|jpeg|png|gif|eot|otf|webp|svg|ttf|woff|woff2|mp4|webm|wav|mp3|m4a|aac|oga)$":
      "<rootDir>/__tests__/__mocks__/fileMock.js",
    "\\.(css|less)$": "<rootDir>/__tests__/__mocks__/styleMock.js",
  },

  setupFiles: [
    "<rootDir>/__tests__/__mocks__/chromeMock.js",
    "<rootDir>/__tests__/__mocks__/variablesMock.js",
  ],

  testPathIgnorePatterns: [
    "<rootDir>/node_modules/",
    "<rootDir>/__tests__/__mocks__/",
    "<rootDir>/src/Button/",
  ],

  verbose: true,

  coverageThreshold: {
    global: {
      statements: 70,
      branches: 69,
      functions: 74,
      lines: 71,
    },
  },
};
