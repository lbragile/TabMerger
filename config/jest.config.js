const ignore_arr = [
  "(<rootDir>/)(?=(node_modules|build|public|(tests/__.+)))",
  "(<rootDir>/src/(components|context)/)(?!(App/App_|Group/Group_f|Tab/Tab_))",
];

module.exports = {
  rootDir: "../",
  moduleNameMapper: {
    "\\.(jpg|jpeg|png|gif|eot|otf|webp|svg|ttf|woff|woff2|mp4|webm|wav|mp3|m4a|aac|oga)$":
      "<rootDir>/tests/__mocks__/fileMock.js",
    "\\.(css|less)$": "<rootDir>/tests/__mocks__/styleMock.js",
  },
  setupFiles: ["<rootDir>/tests/__mocks__/chromeMock.js", "<rootDir>/tests/__mocks__/variablesMock.js"],
  testPathIgnorePatterns: ignore_arr,
  coveragePathIgnorePatterns: ignore_arr,
  verbose: true,
  coverageThreshold: { global: { statements: 95, branches: 95, functions: 95, lines: 95 } },
};
