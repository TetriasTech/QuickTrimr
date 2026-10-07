import assert from 'node:assert/strict';
import test from 'node:test';

import { handleWorkspaceContract } from '../handler.ts';

test('foundation probe returns only its shared constant identity', async () => {
  const response = handleWorkspaceContract(
    new Request(
      'http://localhost/workspace-contract?user_id=forged&role=admin',
    ),
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^application\/json/);
  assert.deepEqual(await response.json(), {
    product: 'QuickTrimr',
    surface: 'function',
  });
});

test('foundation probe rejects non-GET requests without processing their body', async () => {
  const response = handleWorkspaceContract(
    new Request('http://localhost/workspace-contract', {
      method: 'POST',
      body: 'invalid input',
    }),
  );
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'GET');
  assert.deepEqual(await response.json(), { error: 'Use GET.' });
});
