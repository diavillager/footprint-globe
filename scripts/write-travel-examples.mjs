// Node 24: authored data only, no inputs, network requests, or personal file reads.
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildTrip, trips } from '../src/fixtures/travel.ts';

const output = new URL('../private/travel-demo/', import.meta.url);
await mkdir(output, { recursive: true });
for (const trip of trips) {
  const { timeline } = buildTrip(trip.id);
  const filename = `fully-synthetic.${trip.id}.json`;
  try {
    await writeFile(new URL(filename, output), JSON.stringify(timeline, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
    console.log(`${trip.id}: ${timeline.rawSignals.length} fictional points → ${fileURLToPath(new URL(filename, output))}`);
  } catch (error) {
    if (error.code === 'EEXIST') console.log(`${trip.id}: existing file preserved`);
    else throw new Error('SYNTHETIC_OUTPUT_WRITE_FAILED');
  }
}
