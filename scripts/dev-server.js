/**
 * scripts/dev-server.js
 *
 * Minimal static file server for local testing of browser-tool/ only.
 * Not part of the shipped tool (which is meant to be opened as a local
 * file or served by whatever the agent's machine already has) - this
 * exists purely so the browser-tool can be exercised over http:// during
 * development/testing, avoiding file:// CORS restrictions on pdf.js's
 * worker loading.
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = process.env.PORT || 8347;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.pdf': 'application/pdf',
  '.json': 'application/json',
  '.map': 'application/json',
};

http
  .createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    const filePath = path.normalize(path.join(ROOT, urlPath === '/' ? '/browser-tool/index.html' : urlPath));
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found: ' + urlPath);
        return;
      }
      const ext = path.extname(filePath);
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(data);
    });
  })
  .listen(PORT, () => {
    console.log(`Dev server running at http://localhost:${PORT}/browser-tool/index.html`);
  });
