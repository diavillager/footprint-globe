'use strict';
// Public basemap only. No user input paths are accepted.
const fs = require('node:fs');
const { feature } = require('topojson-client');
const topology = require('world-atlas/land-110m.json');
const land = feature(topology, topology.objects.land).features;
fs.mkdirSync('src/assets', { recursive: true });
fs.writeFileSync('src/assets/land.ts', '// Public Natural Earth land via world-atlas 2.0.2; see docs/basemap.md.\nexport const land: object[] = ' + JSON.stringify(land) + ';\n');
