'use strict';
// Creates its own synthetic folder; accepts no user file path.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
let stage = 'startup';
(async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'samsung-diagnostic-synthetic-'));
  let browser;
  try {
    const folder = path.join(temporary, 'PRIVATE_FOLDER');
    await fs.mkdir(path.join(folder, 'jsons', 'com.samsung.shealth.exercise', 'f'), { recursive: true });
    await fs.writeFile(path.join(folder, 'jsons', 'com.samsung.shealth.exercise', 'f', 'PRIVATE_FILENAME.extra_data.json'), JSON.stringify({
      records: [{ latitude: 12.34, longitude: 45.67, start_time: 2208988800000, PRIVATE_KEY: 'PRIVATE_VALUE' }],
    }));
    await fs.writeFile(path.join(folder, 'PRIVATE.csv'), 'latitude,longitude,timestamp\n0,0,2208988800000\n');
    await fs.writeFile(path.join(folder, 'PRIVATE_SUMMARY.csv'), 'create_time,step_count,extra_data\n2208988800000,123,PRIVATE_REFERENCE\n');
    await fs.writeFile(path.join(folder, 'PRIVATE_BROKEN.csv'), 'latitude,longitude\n0,0\n0');
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext();
    let network = 0, errors = 0, leaks = 0;
    context.on('request', request => { if (/^https?:/.test(request.url())) network++; });
    const page = await context.newPage();
    page.on('pageerror', () => errors++);
    page.on('console', message => { if (/PRIVATE|12\.34|2208988800000/.test(message.text())) leaks++; });
    stage = 'offline-worker';
    await page.goto(pathToFileURL(path.resolve(__dirname, '../tools/samsung-diagnostics/index.html')).href);
    await page.locator('#folder').setInputFiles(folder);
    await page.getByText('[CANDIDATES_FOUND]', { exact: false }).waitFor();
    const result = await page.locator('#result').textContent();
    assert.match(result, /좌표\+시각 후보: 2/);
    assert.match(result, /구조 진단 v2/);
    assert.match(result, /\[CSV_WIDTH\] 행 열수 불일치 1/);
    assert.match(result, /좌표 열 없는 요약·관리 필드 1/);
    assert.doesNotMatch(await page.locator('body').innerText(), /PRIVATE|12\.34|2208988800000/);
    assert.equal(await page.evaluate(() => document.getElementById('folder').value), '');
    assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
    stage = 'clear-reselect-cancel';
    await page.getByRole('button', { name: '취소·결과 지우기' }).click();
    assert.doesNotMatch(await page.locator('#result').textContent(), /CANDIDATES_FOUND/);
    await page.locator('#folder').setInputFiles(folder);
    await page.getByRole('button', { name: '취소·결과 지우기' }).click();
    await page.waitForTimeout(200);
    assert.match(await page.locator('#result').textContent(), /지웠습니다/);
    await page.locator('#folder').setInputFiles(folder);
    await page.getByText('[CANDIDATES_FOUND]', { exact: false }).waitFor();
    await page.reload();
    assert.match(await page.locator('#result').textContent(), /아직 폴더/);
    assert.deepEqual({ network, errors, leaks }, { network: 0, errors: 0, leaks: 0 });
    console.log('PASS: offline file:// folder selection, Blob Worker, nested JSON/CSV, clear/cancel/reselect, no persistence/network/value leaks');
  } finally {
    if (browser) await browser.close();
    const resolved = path.resolve(temporary);
    const expectedParent = path.resolve(os.tmpdir());
    if (path.dirname(resolved) !== expectedParent || !path.basename(resolved).startsWith('samsung-diagnostic-synthetic-')) throw new Error('TEMP_SCOPE');
    await fs.rm(resolved, { recursive: true, force: true });
  }
})().catch(() => { console.error('Samsung diagnostic smoke failed at ' + stage + ' (details withheld)'); process.exitCode = 1; });
