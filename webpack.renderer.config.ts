import type { Configuration } from 'webpack';
import MiniCssExtractPlugin from 'mini-css-extract-plugin';
import { rules } from './webpack.rules';
const { pdfResources } = require('./scripts/prepare-pdf-resources.cjs') as { pdfResources(browser: boolean): Promise<{ name: string; bytes: Buffer }[]> };

export const rendererConfig: Configuration = {
  module: {
    rules: [...rules, { test: /\.css$/, use: [MiniCssExtractPlugin.loader, 'css-loader'] }],
  },
  plugins: [new MiniCssExtractPlugin(), {
    apply(compiler) {
      compiler.hooks.thisCompilation.tap('PdfResources', compilation => {
        compilation.hooks.processAssets.tapPromise({ name: 'PdfResources', stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL }, async () => {
          for (const { name, bytes } of await pdfResources(true)) {
            compilation.emitAsset(`main_window/pdfjs/${name}`, new compiler.webpack.sources.RawSource(bytes));
          }
        });
      });
    },
  }],
  resolve: { extensions: ['.ts', '.tsx', '.js'] },
  devtool: 'source-map',
};
