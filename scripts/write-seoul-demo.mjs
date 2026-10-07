// Node 24; only authored source data, no input files or network requests.
import { mkdir, writeFile } from 'node:fs/promises';
import { buildSeoulDemo } from '../src/fixtures/seoul.ts';
const directory = new URL('../docs/demo/', import.meta.url);
await mkdir(directory, {recursive:true});
const {timeline} = buildSeoulDemo();
await writeFile(new URL('fully-synthetic.seoul-2026-10.json',directory), JSON.stringify(timeline,null,2)+'\n');
console.log(`Seoul demo: ${timeline.rawSignals.length} fully synthetic observations`);
