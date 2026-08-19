const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const port = Number(process.env.PORT || 3010);
const body = fs.readFileSync(path.join(__dirname, 'index.html'));
http
  .createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(body);
  })
  .listen(port, '127.0.0.1', () => console.log(`feedback privacy fixture on ${port}`));
