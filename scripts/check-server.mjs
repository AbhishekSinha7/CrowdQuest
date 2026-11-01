import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const portServer = createServer();
await new Promise((resolve) => portServer.listen(0, '127.0.0.1', resolve));
const { port } = portServer.address();
await new Promise((resolve, reject) => portServer.close((error) => error ? reject(error) : resolve()));
const child = spawn(process.execPath, ['server.mjs'], { cwd: fileURLToPath(new URL('..', import.meta.url)), env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
const origin = `http://127.0.0.1:${port}`;
try {
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    try { const response = await fetch(origin); if (response.ok) { ready = true; break; } } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error('Local server did not become ready.');
  for (const path of ['/', '/overlay', '/oauth/callback', '/src/app.js', '/src/overlay.js']) {
    const response = await fetch(`${origin}${path}`);
    if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  }
  const stream = await fetch(`${origin}/api/events`);
  if (!stream.ok || !stream.body) throw new Error('State event stream did not open.');
  const reader = stream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const nextEvent = async () => {
    while (!buffer.includes('\n\n')) {
      const { value, done } = await reader.read();
      if (done) throw new Error('State event stream closed early.');
      buffer += decoder.decode(value, { stream: true });
    }
    const split = buffer.indexOf('\n\n');
    const event = buffer.slice(0, split);
    buffer = buffer.slice(split + 2);
    return event;
  };
  await nextEvent();
  const state = { round: { id: 44, status: 'active' }, hints: [{ text: 'sync check' }] };
  const posted = await fetch(`${origin}/api/state`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state) });
  if (posted.status !== 204) throw new Error(`State POST returned ${posted.status}`);
  const pushed = await nextEvent();
  if (!pushed.includes('"id":44') || !pushed.includes('sync check')) throw new Error('State event did not reach the overlay stream.');
  await reader.cancel();
  console.log('Server smoke check passed: pages load and live state reaches overlay clients.');
} finally {
  child.kill();
}
