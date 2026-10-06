'use strict';
// Generates only authored fixtures. Never accepts or reads an input file.
const fs = require('node:fs');
const path = require('node:path');
const fixtures = { ...require('./synthetic-fixtures.cjs'), ...require('./raw-signal-fixtures.cjs') };
const directory = path.join(__dirname, '../private');
fs.mkdirSync(directory, { recursive: true });
for (const name of Object.keys(fixtures)) {
  const destination = path.join(directory, `fully-synthetic.${name}.json`);
  try {
    fs.writeFileSync(destination, JSON.stringify(fixtures[name](), null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
    process.stdout.write(`합성 예제 생성: private/fully-synthetic.${name}.json\n`);
  } catch (error) {
    if (error.code === 'EEXIST') process.stdout.write(`기존 파일 유지: private/fully-synthetic.${name}.json\n`);
    else { process.stderr.write('합성 예제 파일 저장에 실패했습니다.\n'); process.exitCode = 1; }
  }
}
