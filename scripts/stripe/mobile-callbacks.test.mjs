import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';

import {
  createMobileCallbacks,
  defaultMobileCallback,
} from './mobile-callbacks.mjs';

const config = {
  returnPath: '/connect/return',
  refreshPath: '/connect/refresh',
};

test('local callbacks discard untrusted query data and only redirect to the configured app', async (t) => {
  const target = await defaultMobileCallback();
  const server = createMobileCallbacks(
    config,
    target,
    new URL(target).protocol.slice(0, -1),
  );
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.close();
    server.closeAllConnections();
  });
  assert.equal(server.address().address, '127.0.0.1');
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const action of ['return', 'refresh']) {
    const response = await fetch(
      `${origin}/connect/${action}?status=verified&redirect=https://bad.example`,
      { redirect: 'manual' },
    );
    assert.equal(response.status, 302);
    assert.equal(
      response.headers.get('location'),
      `${target}?action=${action}`,
    );
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.equal((await fetch(`${origin}/anything`)).status, 404);
  assert.equal(
    (await fetch(`${origin}/connect/return`, { method: 'POST' })).status,
    404,
  );
});

test('the bridge accepts loopback Expo Go and rejects arbitrary URLs', () => {
  createMobileCallbacks(
    config,
    'exp://127.0.0.1:8081/--/connect',
    'quicktrimr',
  );
  for (const url of [
    'https://bad.example/connect',
    'exp://bad.example/--/connect',
    'quicktrimr://other',
    'quicktrimr://connect?redirect=bad',
    'quicktrimr://user:password@connect',
    'exp://127.0.0.1:8081/--/other',
  ])
    assert.throws(() => createMobileCallbacks(config, url, 'quicktrimr'));
});
