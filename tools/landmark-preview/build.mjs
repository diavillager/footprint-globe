import { build } from 'vite';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('./',import.meta.url));
for(const provider of ['maptiler','geoapify']) await build({configFile:false,root,base:`/${provider}/`,publicDir:false,
  define:{__PROVIDER__:JSON.stringify(provider)},
  build:{outDir:fileURLToPath(new URL(`../../node_modules/.cache/landmark-preview/${provider}/`,import.meta.url)),emptyOutDir:true},logLevel:'warn'});
console.log('Two isolated localhost preview builds ready');
