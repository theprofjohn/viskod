#!/usr/bin/env node
// Phase 12B Agent Loop fixture server
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const FIXTURE_DIR = __dirname;

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
};

http
  .createServer((req, res) => {
    const url = req.url || '/';

    // Simulate API failure for dogfood network evidence
    if (url.startsWith('/api/')) {
      const body = [];
      req.on('data', (c) => body.push(c));
      req.on('end', () => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error (expected fixture behaviour)' }));
      });
      return;
    }

    // Serve static files
    const filePath = url === '/' ? '/index.html' : url;
    const fullPath = path.join(FIXTURE_DIR, filePath);
    const ext = path.extname(filePath);

    fs.readFile(fullPath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(data);
    });
  })
  .listen(3000, '127.0.0.1', () => {
    console.log('Phase 12B fixture server on http://localhost:3000');
  });
