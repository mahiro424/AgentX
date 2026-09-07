import type { ForgeConfig } from '@electron-forge/shared-types';
import { WebpackPlugin } from '@electron-forge/plugin-webpack';
import { mainConfig } from './webpack.main.config';
import { rendererConfig } from './webpack.renderer.config';

const config: ForgeConfig = {
  packagerConfig: { asar: true, executableName: 'AgentX' },
  rebuildConfig: {},
  makers: [],
  plugins: [new WebpackPlugin({
    mainConfig,
    port: 33870,
    loggerPort: 33871,
    devContentSecurityPolicy: "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ws://localhost:33870; base-uri 'none'; form-action 'none'",
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
