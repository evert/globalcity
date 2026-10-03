import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

export default defineConfig({
  server: {
    host: true, // listen on 0.0.0.0 so other machines on the LAN can open the dev client
    port: 5173,
    proxy: {
      '/ws': { target: `ws://localhost:${process.env.PORT ?? 8787}`, ws: true },
      '/ATTRIBUTION.md': `http://localhost:${process.env.PORT ?? 8787}`,
      '/LICENSE': `http://localhost:${process.env.PORT ?? 8787}`,
      '/health': `http://localhost:${process.env.PORT ?? 8787}`,
    },
    fs: { allow: [repoRoot] },
  },
  build: { target: 'es2022', sourcemap: true },
});
