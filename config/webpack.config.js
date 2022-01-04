/* eslint-disable @typescript-eslint/no-var-requires */
const path = require("path");

const CopyPlugin = require("copy-webpack-plugin");
const DotenvPlugin = require("dotenv-webpack");
const ESLintPlugin = require("eslint-webpack-plugin");
const StylelintPlugin = require("stylelint-webpack-plugin");
const { TsconfigPathsPlugin } = require("tsconfig-paths-webpack-plugin");
const { SourceMapDevToolPlugin } = require("webpack");

const isProd = process.env.NODE_ENV === "production";

const lintOpts = {
  extensions: ["ts", "tsx"],
  files: ["src/**/*"],
  failOnError: false
};

const configFile = path.join(__dirname, "tsconfig.json");

module.exports = {
  entry: {
    popup: path.resolve(__dirname, "../src/index.tsx"),
    background: path.resolve(__dirname, "../src/background.ts")
  },
  plugins: [
    new CopyPlugin({
      patterns: [
        {
          from: "public",
          globOptions: {
            ignore: ["**/logo-full-rescale.png"]
          }
        }
      ]
    }),
    new SourceMapDevToolPlugin({
      exclude: isProd ? ["vendors.js", "background.js", "runtime.js", "popup.js"] : ["vendors.js"]
    }),
    new ESLintPlugin(lintOpts),
    new StylelintPlugin(lintOpts),
    new DotenvPlugin({
      path: `./.env.${process.env.NODE_ENV}.local`,
      safe: true,
      allowEmptyValues: true
    })
  ],
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: {
          loader: "babel-loader",
          options: {
            cacheDirectory: true
          }
        },
        exclude: /node_modules/
      },
      {
        test: /\.tsx?$/,
        loader: "ts-loader",
        options: {
          configFile
        },
        exclude: /node_modules/
      },
      {
        test: /\.png$/,
        use: [
          {
            loader: "url-loader",
            options: {
              mimetype: "image/png"
            }
          }
        ]
      }
    ]
  },
  resolve: {
    extensions: [".js", ".jsx", ".ts", ".tsx"],
    plugins: [new TsconfigPathsPlugin({ configFile })]
  },
  stats: isProd ? "normal" : "minimal",
  mode: isProd ? "production" : "development",
  watch: !isProd,
  devtool: false,
  output: {
    path: path.resolve(__dirname, isProd ? "../build" : "../dist"),
    filename: "[name].js",
    clean: true
  }
};
