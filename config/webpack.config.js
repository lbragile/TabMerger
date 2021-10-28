const path = require("path");
const CopyPlugin = require("copy-webpack-plugin");
const { SourceMapDevToolPlugin } = require("webpack");
const ESLintPlugin = require("eslint-webpack-plugin");
const StylelintPlugin = require("stylelint-webpack-plugin");

const lintOpts = {
  extensions: ["ts", "tsx"],
  files: ["src/**/*"],
  failOnError: false,
};

module.exports = (env) => {
  const isProd = env.production;

  return {
    entry: {
      popup: path.resolve(__dirname, "../src/index.tsx"),
      background: path.resolve(__dirname, "../src/background.ts"),
    },
    plugins: [
      new CopyPlugin({
        patterns: [{ from: "public", to: "." }],
      }),
      new SourceMapDevToolPlugin({
        filename: "[name].js.map",
        exclude: isProd ? ["vendor.js", "background.js", "popup.js"] : ["vendor.js"],
      }),
      new ESLintPlugin(lintOpts),
      new StylelintPlugin(lintOpts),
    ],
    module: {
      rules: [
        {
          test: /\.(js|jsx)$/,
          use: "babel-loader",
          exclude: /node_modules/,
        },
        {
          test: /\.ts(x)?$/,
          loader: "ts-loader",
          exclude: /node_modules/,
        },
        {
          test: /\.png$/,
          use: [
            {
              loader: "url-loader",
              options: {
                mimetype: "image/png",
              },
            },
          ],
        },
      ],
    },
    resolve: {
      extensions: [".js", ".jsx", ".ts", ".tsx"],
    },
    stats: "minimal",
    mode: isProd ? "production" : "development",
    watch: !isProd,
    devtool: isProd ? false : "inline-cheap-source-map",
    optimization: {
      runtimeChunk: "single",
      splitChunks: {
        cacheGroups: {
          vendor: {
            test: /[\\/]node_modules[\\/]/,
            name: "vendors",
            enforce: true,
            chunks: "all",
          },
        },
      },
    },
    output: {
      path: path.resolve(__dirname, isProd ? "../build" : "../dist"),
      filename: "[name].js",
      clean: true,
    },
  };
};
