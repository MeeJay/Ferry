import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8')) as { version: string };
const api = process.env.FERRY_API || 'http://localhost:3001';

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@ferry/shared': path.resolve(__dirname, '../shared/src/index.ts'),
    },
  },
  build: { target: ['es2020', 'chrome87', 'edge88', 'firefox78', 'safari14'] },
  server: {
    port: 5173,
    proxy: Object.fromEntries(['/api', '/auth', '/raw', '/branding', '/health'].map((p) => [p, { target: api, changeOrigin: false }])),
  },
});
