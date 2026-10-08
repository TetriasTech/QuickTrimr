import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';

import { build } from 'esbuild';

import { fixturePage } from './admin-fixture-data.mjs';

const root = resolve(import.meta.dirname, '../..');
assert.equal(
  process.argv.length,
  2,
  'Fixture harness accepts no arguments, credentials or target URLs.',
);
const result = await build({
  entryPoints: [resolve(root, 'apps/admin/fixtures/client.tsx')],
  bundle: true,
  write: false,
  platform: 'browser',
  jsx: 'automatic',
  minify: true,
  alias: { '@': resolve(root, 'apps/admin/src') },
});
const script = result.outputFiles[0].contents;
const staticRoot = resolve(root, 'apps/admin/.next/static');
const cssFiles = (await readdir(staticRoot, { recursive: true })).filter((f) =>
  f.endsWith('.css'),
);
assert.ok(
  cssFiles.length > 0,
  'Build the admin app first for its actual compiled Tailwind CSS.',
);
const css = (
  await Promise.all(
    cssFiles.map((f) => readFile(resolve(staticRoot, f), 'utf8')),
  )
).join('\n');
let attempts = 0;
async function handle(req, res) {
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-content-type-options', 'nosniff');
  const url = new URL(req.url, 'http://127.0.0.1:3101');
  const send = (status, type, body) => {
    if (res.destroyed || res.writableEnded) return;
    res.writeHead(status, { 'content-type': type });
    res.end(body);
  };
  if (req.method === 'GET' && url.pathname === '/')
    return send(
      200,
      'text/html',
      '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>QuickTrimr fixture harness</title><link rel="stylesheet" href="/styles.css"><div id="root"></div><script src="/fixture.js"></script></html>',
    );
  if (req.method === 'GET' && url.pathname === '/fixture.js')
    return send(200, 'text/javascript', script);
  if (req.method === 'GET' && url.pathname === '/styles.css')
    return send(200, 'text/css', css);
  if (req.method === 'GET' && url.pathname === '/api/bookings') {
    const page = fixturePage(url.searchParams);
    return send(
      page ? 200 : 422,
      'application/json',
      JSON.stringify(page ?? { error: 'invalid_fixture_query' }),
    );
  }
  if (req.method === 'POST' && url.pathname === '/api/confirm') {
    let bytes = 0,
      body = '';
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes <= 1024) body += chunk.toString();
    }
    if (bytes > 1024) return send(413, 'application/json', '{}');
    let input;
    try {
      input = JSON.parse(body);
    } catch {
      return send(422, 'application/json', '{}');
    }
    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      typeof input.reason !== 'string' ||
      !input.reason.trim() ||
      Object.keys(input).some((k) => k !== 'reason')
    )
      return send(422, 'application/json', '{}');
    attempts++;
    // Explicit synthetic failure/latency for UI testing; no action is performed.
    const count = attempts;
    setTimeout(
      () =>
        send(
          count === 1 ? 503 : 200,
          'application/json',
          JSON.stringify({ attempts: count }),
        ),
      150,
    );
    return;
  }
  send(404, 'text/plain', 'Fixture route not found');
}
const server = createServer((req, res) => {
  handle(req, res).catch(() => {
    if (res.destroyed || res.writableEnded) return;
    // Never expose a request body or internal diagnostic in fixture responses.
    if (res.headersSent) return res.destroy();
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end('{"error":"fixture_request_failed"}');
  });
});
server.listen(3101, '127.0.0.1', () =>
  console.log('Synthetic-only fixture harness: http://127.0.0.1:3101'),
);
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () => server.close());
