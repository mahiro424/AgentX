import type { Configuration } from 'webpack';
import MiniCssExtractPlugin from 'mini-css-extract-plugin';
import { rules } from './webpack.rules';

export const rendererConfig: Configuration = {
  module: {
    rules: [...rules, { test: /\.css$/, use: [MiniCssExtractPlugin.loader, 'css-loader'] }],
  },
  plugins: [new MiniCssExtractPlugin()],
  resolve: { extensions: ['.ts', '.tsx', '.js'] },
  devtool: 'source-map',
};
