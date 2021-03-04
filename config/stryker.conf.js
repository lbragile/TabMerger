/**
 * @type {import('@stryker-mutator/api/core').StrykerOptions}
 */

module.exports = {
  // mutator: { excludedMutations: ["ObjectLiteral", "ArithmeticOperator", "ArrayDeclaration"] },
  packageManager: "npm",
  reporters: ["html", "clear-text", "progress", "dots", "dashboard", "json"],
  testRunner: "jest",
  coverageAnalysis: "off",
  jest: { enableFindRelatedTests: false, config: require("./jest.config.js") },
  dryRunTimeoutMinutes: 2,
  timeoutMS: 30 * 1000,
  timeoutFactor: 3,
  thresholds: { high: 95, low: 85, break: 75 },
  dashboard: {
    project: "github.com/lbragile/TabMerger",
    version: "master",
    baseUrl: "https://dashboard.stryker-mutator.io/api/reports",
    reportType: "full",
    module: process.argv[process.argv.length - 1],
  },
};
