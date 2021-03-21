const path = require("path");

module.exports = function override(config) {
  config.resolve = {
    ...config.resolve,
    alias: {
      ...config.alias,
      "@App": path.resolve(__dirname, "src/components/App"),
      "@Group": path.resolve(__dirname, "src/components/Group"),
      "@Tab": path.resolve(__dirname, "src/components/Tab"),
      "@Extra": path.resolve(__dirname, "src/components/Extra"),
      "@Button": path.resolve(__dirname, "src/components/Button"),
      "@Typings": path.resolve(__dirname, "src/typings"),
      "@Constants": path.resolve(__dirname, "src/constants"),
      "@Context": path.resolve(__dirname, "src/context"),
    },
  };

  return config;
};
