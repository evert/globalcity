import { defineConfig, type Plugin } from 'vite';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

// Every production build gets a unique version; the server reads dist/version.json and tells clients
// running an older build to reload. The dev server reports 'dev' and never triggers reloads.
const buildVersion = `${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')}-${randomBytes(3).toString('hex')}`;
const versionFile = (): Plugin => ({
  name: 'globalcity-version',
  apply: 'build',
  generateBundle() { this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version: buildVersion }) + '\n' }); },
});

export default defineConfig(({ command }) => ({
  define: { __BUILD_VERSION__: JSON.stringify(command === 'build' ? buildVersion : 'dev') },
  plugins: [versionFile()],
  server: {
    host: true, // listen on 0.0.0.0 so other machines on the LAN can open the dev client
    port: 5173,
    proxy: {
      '/ws': { target: `ws://localhost:${process.env.PORT ?? 8787}`, ws: true },
      '/ATTRIBUTION.md': `http://localhost:${process.env.PORT ?? 8787}`,
      '/LICENSE': `http://localhost:${process.env.PORT ?? 8787}`,
      '/health': `http://localhost:${process.env.PORT ?? 8787}`,
      '/overview.bin': `http://localhost:${process.env.PORT ?? 8787}`,
      '/api': `http://localhost:${process.env.PORT ?? 8787}`,
    },
    fs: { allow: [repoRoot] },
  },
  build: { target: 'es2022', sourcemap: true },
}));
