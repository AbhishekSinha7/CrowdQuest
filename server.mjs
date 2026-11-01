import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

const root = resolve('.');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
let latestState = null;
const stateStreams = new Set();
function broadcastState(value) {
  latestState = value;
  const packet = `data: ${JSON.stringify(value)}\n\n`;
  for (const stream of stateStreams) stream.write(packet);
}
const server = createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (pathname === '/api/events' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(`data: ${JSON.stringify(latestState)}\n\n`);
    stateStreams.add(res);
    req.on('close', () => stateStreams.delete(res));
    return;
  }
  if (pathname === '/api/state' && req.method === 'POST') {
    let body = '';
    req.setEncoding('utf8');
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 1_000_000) { res.writeHead(413).end('State too large'); return; }
    }
    try { broadcastState(JSON.parse(body)); res.writeHead(204).end(); }
    catch { res.writeHead(400).end('Invalid state'); }
    return;
  }
  const requested = pathname === '/' ? 'index.html' : pathname === '/overlay' ? 'overlay.html' : pathname === '/oauth/callback' ? 'oauth-callback.html' : pathname.slice(1);
  const file = resolve(root, requested);
  if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403).end('Forbidden'); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404).end('Not found'); }
});
const port = Number(process.env.PORT) || 4173;
const host = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
server.listen(port, host, () => console.log(`CrowdQuest ready at http://${host}:${port}`));
