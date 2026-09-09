import type { Configuration } from 'webpack';
import { rules } from './webpack.rules';

export const mainConfig: Configuration = {
  entry: { index: './src/main/index.ts', 'office-reader': './src/main/tools/office-reader.cjs', 'office-cli': './src/main/tools/office-cli.cjs' },
  output: { filename: '[name].js' },
  // ZIP 只使用本地 Buffer 入口；保留未安装的可选 S3 SDK 为运行时错误，不提供空模块或联网能力。
  externals: { '@aws-sdk/client-s3': 'commonjs @aws-sdk/client-s3' },
  module: { rules },
  resolve: { extensions: ['.ts', '.tsx', '.js'] },
  devtool: 'source-map',
};
