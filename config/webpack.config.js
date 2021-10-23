const path = require("path");
const CopyPlugin = require("copy-webpack-plugin");

const config = {
  entry: {
    popup: path.resolve(__dirname, "../src/index.tsx"),
    content: path.resolve(__dirname, "../src/content.ts"),
    background: path.resolve(__dirname, "../src/background.ts"),
  },
  output: { path: path.resolve(__dirname, "../dist"), filename: "[name].js" },
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
  plugins: [
    new CopyPlugin({
      patterns: [{ from: "public", to: "." }],
    }),
  ],
};

module.exports = config;
