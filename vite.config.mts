import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  publicDir: false,
  server: { host: '127.0.0.1', strictPort: true, fs: { deny: ['**/private/**', '**/local-data/**', '**/*.json', '**/*.{jpg,jpeg,png,heic,webp}', '**/.env*', '**/.git/**'] } },
  preview: { host: '127.0.0.1', strictPort: true },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
