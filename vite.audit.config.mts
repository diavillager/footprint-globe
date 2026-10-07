import { defineConfig } from 'vite';

// Separate output/cache: building the diagnostic must not refresh an active map session.
export default defineConfig({
  root:'tools/timeline-audit', publicDir:false,
  cacheDir:'../../node_modules/.cache/timeline-audit-vite',
  build:{outDir:'../../node_modules/.cache/timeline-audit-dist',emptyOutDir:true},
  preview:{host:'127.0.0.1',strictPort:true},
});
