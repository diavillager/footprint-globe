import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';

export default defineConfig(({ mode }) => ({
  define: { __MAPTILER_KEY__: JSON.stringify(loadEnv(mode, '.', '').VITE_MAPTILER_API_KEY ?? loadEnv(mode, '.', '').MAPTILER_API_KEY ?? '') },
  plugins: [react(), {
    name: 'local-only-policy',
    transformIndexHtml(_html, context) {
      const connect = context.server ? "'self' ws://127.0.0.1:* https://api.maptiler.com" : "'self' https://api.maptiler.com";
      const scripts = context.server ? "'self' 'unsafe-inline'" : "'self'";
      return [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: `default-src 'none'; script-src ${scripts}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://api.maptiler.com; worker-src 'self' blob:; connect-src ${connect}; base-uri 'none'; form-action 'none'; object-src 'none'` }, injectTo: 'head-prepend' }];
    },
  }],
  publicDir: false,
  optimizeDeps: { exclude: ['maplibre-gl'] },
  server: { host: '127.0.0.1', strictPort: true, fs: { deny: ['**/private/**', '**/local-data/**', '**/*.json', '**/*.{jpg,jpeg,png,heic,webp}', '**/.env*', '**/.git/**'] } },
  preview: { host: '127.0.0.1', strictPort: true },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
}));
