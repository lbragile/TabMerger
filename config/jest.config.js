module.exports = {
  rootDir: "../",

  moduleNameMapper: {
    "\\.(jpg|jpeg|png|gif|eot|otf|webp|svg|ttf|woff|woff2|mp4|webm|wav|mp3|m4a|aac|oga)$":
      "<rootDir>/tests/__mocks__/fileMock.js",
    "\\.(css|less)$": "<rootDir>/tests/__mocks__/styleMock.js",
  },

  setupFiles: ["<rootDir>/tests/__mocks__/chromeMock.js", "<rootDir>/tests/__mocks__/variablesMock.js"],

  testPathIgnorePatterns: [
    "<rootDir>/node_modules/",
    "<rootDir>/build/",
    "<rootDir>/public/",
    "<rootDir>/tests/__mocks__/",
    "<rootDir>/src/components/Button/",
    "<rootDir>/src/other/",
  ],

  coveragePathIgnorePatterns: [
    "<rootDir>/node_modules/",
    "<rootDir>/build/",
    "<rootDir>/public/",
    "<rootDir>/src/components/Button/",
    "<rootDir>/src/other/",
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
