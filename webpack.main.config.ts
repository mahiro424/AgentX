import type { Configuration } from 'webpack';
import { rules } from './webpack.rules';
import path from 'node:path';

export const mainConfig: Configuration = {
  entry: { index: './src/main/index.ts', 'office-reader': './src/main/tools/office-reader.cjs', 'office-cli': './src/main/tools/office-cli.cjs' },
  output: { filename: '[name].js' },
  // ZIP 只使用本地 Buffer 入口；保留未安装的可选 S3 SDK 为运行时错误，不提供空模块或联网能力。
  externals: { '@aws-sdk/client-s3': 'commonjs @aws-sdk/client-s3' },
  module: { rules },
  resolve: { extensions: ['.ts', '.tsx', '.js'], alias: {
    // 使用同版本公开 ESM 发布入口，避免 CJS 内嵌 JSZip 的动态 require 被二次解析。
    'docx$': path.join(path.dirname(require.resolve('docx')), 'index.mjs'),
  } },
  devtool: 'source-map',
};
