/**
 * @type {import('@stryker-mutator/api/core').StrykerOptions}
 */

module.exports = {
  mutator: { excludedMutations: ["ObjectLiteral", "ArithmeticOperator", "ArrayDeclaration"] },
  packageManager: "npm",
  reporters: ["html", "clear-text", "progress", "dots", "dashboard", "json"],
  testRunner: "jest",
  coverageAnalysis: "off",
  jest: { enableFindRelatedTests: false, config: require("./jest.config.js") },
  dryRunTimeoutMinutes: 1,
  timeoutMS: 45 * 1000,
  timeoutFactor: 4,
  thresholds: { high: 90, low: 70, break: 50 },
  dashboard: {
    project: "github.com/lbragile/TabMerger",
    version: "master",
    baseUrl: "https://dashboard.stryker-mutator.io/api/reports",
    reportType: "full",
  },
};
