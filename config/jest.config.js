const ignore_arr = [
  "(<rootDir>/)(?=(node_modules|build|(public/)(?!(.+js$))|(tests/__.+)))",
  "(<rootDir>/src/(components|context|constants)/)(?!(App/App_|Group/Group_|Tab/Tab_))",
];

// set jest or styker variables
const jest = process.argv.some((x) => x.includes("jest"));
const rootDir = jest ? "../" : ".";
const roots = jest ? ["tests/"] : ["src/", "tests/"];

module.exports = {
  rootDir,
  roots,
  moduleNameMapper: {
    "\\.(jpg|jpeg|png|gif|eot|otf|webp|svg|ttf|woff|woff2|mp4|webm|wav|mp3|m4a|aac|oga)$":
      "<rootDir>/tests/__mocks__/fileMock.js",
    "\\.(css|less)$": "<rootDir>/tests/__mocks__/styleMock.js",
  },
  setupFiles: [
    "<rootDir>/tests/__mocks__/chromeMock.js",
    "<rootDir>/tests/__mocks__/variablesMock.js",
    "<rootDir>/tests/__mocks__/moduleMock.js",
  ],
  testPathIgnorePatterns: ignore_arr,
  coveragePathIgnorePatterns: ignore_arr,
  verbose: true,
  coverageThreshold: { global: { statements: 95, branches: 95, functions: 95, lines: 95 } },
};
