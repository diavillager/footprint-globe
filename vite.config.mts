import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react(), {
    name: 'local-only-policy',
    transformIndexHtml(_html, context) {
      const connect = context.server ? "'self' ws://127.0.0.1:*" : "'none'";
      const scripts = context.server ? "'self' 'unsafe-inline'" : "'self'";
      return [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: `default-src 'none'; script-src ${scripts}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; worker-src 'self'; connect-src ${connect}; base-uri 'none'; form-action 'none'; object-src 'none'` }, injectTo: 'head-prepend' }];
    },
  }],
  publicDir: false,
  server: { host: '127.0.0.1', strictPort: true, fs: { deny: ['**/private/**', '**/local-data/**', '**/*.json', '**/*.{jpg,jpeg,png,heic,webp}', '**/.env*', '**/.git/**'] } },
  preview: { host: '127.0.0.1', strictPort: true },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
