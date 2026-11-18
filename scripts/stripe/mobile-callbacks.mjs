import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { loadVerificationConfig } from './config.mjs';

export async function defaultMobileCallback() {
  const { expo } = JSON.parse(
    await readFile(
      new URL('../../apps/mobile/app.json', import.meta.url),
      'utf8',
    ),
  );
  return `${expo.scheme}://connect`;
}

export function createMobileCallbacks(config, callbackUrl, appScheme) {
  const target = new URL(callbackUrl);
  const expoGo =
    target.protocol === 'exp:' &&
    ['localhost', '127.0.0.1'].includes(target.hostname) &&
    target.pathname === '/--/connect';
  const native =
    target.protocol === `${appScheme}:` &&
    target.hostname === 'connect' &&
    !target.pathname;
  if (
    (!native && !expoGo) ||
    target.username ||
    target.password ||
    target.search ||
    target.hash
  )
    throw new Error(
      'Use the app Connect URL or a loopback Expo Go Connect URL.',
    );

  return createServer((request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    const action =
      path === config.returnPath
        ? 'return'
        : path === config.refreshPath
          ? 'refresh'
          : null;
    if (request.method !== 'GET' || !action) {
      response.writeHead(404, { 'cache-control': 'no-store' });
      return response.end('Not found');
    }
    const destination = new URL(target);
    destination.searchParams.set('action', action);
    // Incoming query data never influences the target or verification state.
    response.writeHead(302, {
      location: destination.href,
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
    });
    response.end();
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const config = await loadVerificationConfig();
  const callbackUrl = process.argv[2] ?? (await defaultMobileCallback());
  const scheme = new URL(await defaultMobileCallback()).protocol.slice(0, -1);
  const server = createMobileCallbacks(config, callbackUrl, scheme);
  server.on('error', () => {
    console.error('Could not start the local Stripe mobile callback bridge.');
    process.exitCode = 1;
  });
  server.listen(config.port, '127.0.0.1', () => {
    console.log(
      'Local Stripe mobile callbacks ready on the approved loopback port.',
    );
  });
}
