import type { ForgeConfig } from '@electron-forge/shared-types';
import { WebpackPlugin } from '@electron-forge/plugin-webpack';
import { mainConfig } from './webpack.main.config';
import { rendererConfig } from './webpack.renderer.config';
import path from 'node:path';

const { prepareCodex } = require('./scripts/prepare-codex.cjs') as { prepareCodex(): Promise<string> };
const { prepareOfficeLicenses } = require('./scripts/prepare-office-licenses.cjs') as { prepareOfficeLicenses(): Promise<string> };
const { preparePdfResources } = require('./scripts/prepare-pdf-resources.cjs') as { preparePdfResources(): Promise<string> };

const config: ForgeConfig = {
  packagerConfig: { asar: true, executableName: 'AgentX', extraResource: [path.resolve(__dirname, '.cache/engine'), path.resolve(__dirname, '.cache/licenses/THIRD_PARTY_NOTICES.txt'), path.resolve(__dirname, '.cache/pdfjs')] },
  hooks: {
    prePackage: async (_config, platform, arch) => {
      if (platform !== 'win32' || arch !== 'x64') throw new Error('M1 只打包 Windows x64');
      await prepareCodex();
      await prepareOfficeLicenses();
      await preparePdfResources();
    },
    preStart: async () => { await prepareCodex(); await preparePdfResources(); },
  },
  rebuildConfig: {},
  makers: [],
  plugins: [new WebpackPlugin({
    mainConfig,
    port: 33870,
    loggerPort: 33871,
    devContentSecurityPolicy: "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self'; font-src 'self' data:; img-src 'self' data:; connect-src 'self' ws://localhost:33870; base-uri 'none'; form-action 'none'",
    renderer: {
      config: rendererConfig,
      nodeIntegration: false,
      entryPoints: [{
        name: 'main_window',
        html: './src/renderer/index.html',
        js: './src/renderer/index.tsx',
        preload: { js: './src/preload/index.ts' },
      }],
    },
  })],
};

export default config;
