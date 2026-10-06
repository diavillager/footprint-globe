'use strict';
// Separate loopback-only experiment. Never serves repository files or Timeline input.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('node:util');

function createMapCheckServer({ key } = {}) {
  if (key === undefined) {
    try { key = parseEnv(fs.readFileSync(path.join(__dirname, '../../.env.local'), 'utf8')).MAPTILER_API_KEY || ''; }
    catch { key = ''; }
  }
  const files = new Map([
    ['/', ['index.html', 'text/html; charset=utf-8']],
    ['/check.js', ['check.js', 'text/javascript; charset=utf-8']],
    ['/check.css', ['check.css', 'text/css; charset=utf-8']],
  ]);
  return http.createServer((req, res) => {
    const origin = `http://127.0.0.1:${res.socket.localPort}`;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self' https://cdn.maptiler.com 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline' https://cdn.maptiler.com; connect-src 'self' https://api.maptiler.com; img-src 'self' data: blob: https://api.maptiler.com https://cdn.maptiler.com; worker-src blob:; font-src https://api.maptiler.com; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    if (req.headers.host !== new URL(origin).host || req.method !== 'GET') {
      res.writeHead(403); return res.end('REQUEST_DENIED');
    }
    if (req.url === '/config') {
      // No CORS, and reject cross-site/non-browser probes of this local credential.
      if (req.headers['sec-fetch-site'] !== 'same-origin' || (req.headers.origin && req.headers.origin !== origin)) {
        res.writeHead(403); return res.end('REQUEST_DENIED');
      }
      res.writeHead(key.trim() ? 200 : 503, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(key.trim() ? { key: key.trim() } : { code: 'KEY_MISSING' }));
    }
    const file = files.get(req.url);
    if (!file) { res.writeHead(404); return res.end('NOT_FOUND'); }
    res.writeHead(200, { 'Content-Type': file[1] });
    res.end(fs.readFileSync(path.join(__dirname, file[0])));
  });
}

if (require.main === module) {
  const server = createMapCheckServer();
  server.on('error', () => { console.error('MAP_CHECK_SERVER_FAILED'); process.exitCode = 1; });
  server.listen(4174, '127.0.0.1', () => console.log('MapTiler 공개 지역 검증: http://127.0.0.1:4174'));
}
module.exports = { createMapCheckServer };
