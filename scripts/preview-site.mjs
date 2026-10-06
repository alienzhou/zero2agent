import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSite } from './build-site.mjs';

const root = fileURLToPath(new URL('../site/', import.meta.url)).replace(/\/$/, '');
const portIndex = process.argv.indexOf('--port');
const port = Number(portIndex === -1 ? 8788 : process.argv[portIndex + 1]);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Use --port with a valid port number.');
await buildSite();
const types = {'.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8'};
const server = http.createServer(async (request, response) => {
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, {'Allow': 'GET, HEAD'}); response.end(); return;
  }
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const filename = path.resolve(root, '.' + pathname + (pathname.endsWith('/') ? 'index.html' : ''));
    if (!filename.startsWith(root + path.sep)) {
      response.writeHead(403); response.end(); return;
    }
    const bytes = await readFile(filename);
    response.writeHead(200, {'Content-Type': types[path.extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-store'});
    response.end(request.method === 'HEAD' ? undefined : bytes);
  } catch (error) {
    response.writeHead(error.code === 'ENOENT' || error.code === 'EISDIR' ? 404 : 400);
    response.end();
  }
});
server.on('error', error => {
  console.error(error.code === 'EADDRINUSE' ? 'Port ' + port + ' is in use. Try pnpm site:preview --port 8790.' : error.message);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => console.log('Course preview: http://127.0.0.1:' + port + '/'));
