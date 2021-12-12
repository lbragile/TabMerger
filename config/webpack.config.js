const path = require("path");
const CopyPlugin = require("copy-webpack-plugin");
const { SourceMapDevToolPlugin } = require("webpack");
const ESLintPlugin = require("eslint-webpack-plugin");
const StylelintPlugin = require("stylelint-webpack-plugin");
const Dotenv = require("dotenv-webpack");

const isProd = process.env.NODE_ENV === "production";

const lintOpts = {
  extensions: ["ts", "tsx"],
  files: ["src/**/*"],
  failOnError: false,
};

module.exports = {
  entry: {
    popup: path.resolve(__dirname, "../src/index.tsx"),
    background: path.resolve(__dirname, "../src/background.ts"),
  },
  plugins: [
    new CopyPlugin({
      patterns: [
        {
          from: "public",
          globOptions: {
            ignore: ["**/logo-full-rescale.png"],
          },
        },
      ],
    }),
    new SourceMapDevToolPlugin({
      exclude: isProd ? ["vendors.js", "background.js", "runtime.js", "popup.js"] : ["vendors.js"],
    }),
    new ESLintPlugin(lintOpts),
    new StylelintPlugin(lintOpts),
    new Dotenv({
      path: "./.env",
      safe: true,
    }),
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
  stats: isProd ? "normal" : "minimal",
  mode: isProd ? "production" : "development",
  watch: !isProd,
  devtool: false,
  output: {
    path: path.resolve(__dirname, isProd ? "../build" : "../dist"),
    filename: "[name].js",
    clean: true,
  },
};
