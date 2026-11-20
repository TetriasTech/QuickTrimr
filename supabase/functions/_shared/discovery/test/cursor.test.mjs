import assert from 'node:assert/strict';
import test from 'node:test';

import { createDiscoveryCursorCodec } from '../cursor.ts';
const secret = Buffer.alloc(32, 7).toString('base64'); // Unit fixture only; never an environment default.
const sort = {
  demoted: false,
  distanceMeters: 1234.56789,
  priceCents: 4500,
  rating: null,
  ratingCount: 0,
  barberId: '91f09000-0000-4000-8000-000000000001',
};
test('opaque AES-GCM cursor authenticates sort keys, query/client binding and server key', async () => {
  const codec = await createDiscoveryCursorCodec(secret),
    binding = 'client-one|query-one';
  const a = await codec.seal(sort, binding),
    b = await codec.seal(sort, binding);
  assert.notEqual(a, b);
  assert.match(a, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.deepEqual(await codec.open(a, binding), sort);
  for (const cursor of [
    'eyJkaXN0YW5jZSI6MTIzNH0',
    a.replace('v1.', 'v2.'),
    'x'.repeat(5000),
  ])
    await assert.rejects(
      codec.open(cursor, binding),
      /Invalid discovery cursor/,
    );
  const [version, iv, body] = a.split('.');
  const altered = `${version}.${iv}.${body[0] === 'A' ? 'B' : 'A'}${body.slice(1)}`;
  await assert.rejects(codec.open(altered, binding));
  await assert.rejects(codec.open(a, 'client-two|query-one'));
  await assert.rejects(codec.open(a, 'client-one|query-two'));
  const other = await createDiscoveryCursorCodec(
    Buffer.alloc(32, 8).toString('base64'),
  );
  await assert.rejects(other.open(a, binding));
  await assert.rejects(
    createDiscoveryCursorCodec('bad'),
    (error) => !String(error).includes(secret),
  );
});
