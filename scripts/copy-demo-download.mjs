// Publish only this explicitly authored fixture, never a directory of user files.
import { copyFile, mkdir } from 'node:fs/promises';
const destination = new URL('../dist/downloads/', import.meta.url);
await mkdir(destination, { recursive: true });
await copyFile(
  new URL('../docs/demo/fully-synthetic.seoul-2026-10.json', import.meta.url),
  new URL('fully-synthetic.seoul-2026-10.json', destination),
);
