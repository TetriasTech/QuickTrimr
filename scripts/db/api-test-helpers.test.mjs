import assert from 'node:assert/strict';
import test from 'node:test';

import { apiJson, assertDenied, assertRawBody } from './api-test-helpers.mjs';

const local = { API_URL: 'http://127.0.0.1:55321', ANON_KEY: 'synthetic-key' };

test('raw-body privacy assertions compare all fields and suppress mismatch values', () => {
  assertRawBody([{ id: 'synthetic' }], [{ id: 'synthetic' }], 'test');
  for (const actual of [
    [{ id: 'synthetic', private: 'do-not-print' }],
    [{ id: 'other' }],
  ]) {
    assert.throws(
      () => assertRawBody(actual, [{ id: 'synthetic' }], 'test'),
      (error) => {
        assert.ok(!error.message.includes('do-not-print'));
        return /raw body mismatch/.test(error.message);
      },
    );
  }
});

test('API helper rejects hosted targets, cross-origin paths and URL credentials before fetch', async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  let calls = 0;
  globalThis.fetch = () => {
    calls++;
    throw new Error('Unexpected request');
  };
  await assert.rejects(
    apiJson(
      { ...local, API_URL: 'https://example.invalid' },
      '/rest/v1/profiles',
      'token',
    ),
    /non-QuickTrimr/,
  );
  await assert.rejects(
    apiJson(local, 'https://example.invalid/rest/v1/profiles', 'token'),
    /cross-origin/,
  );
  await assert.rejects(
    apiJson(
      local,
      'http://user:password@127.0.0.1:55321/rest/v1/profiles',
      'token',
    ),
    /credentials/,
  );
  await assert.rejects(
    apiJson(local, '/rest/v1/rpc/current_user_role', 'token', {
      method: 'POST',
      body: {},
    }),
    /Serialize JSON/,
  );
  assert.equal(calls, 0);
});

test('denial helper rejects private response fields and wrong HTTP/code without dumping data', async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.redirect, 'error');
    return Response.json([{ private: 'do-not-print' }]);
  };
  await assert.rejects(
    assertDenied(local, '/rest/v1/profiles', 'token'),
    /raw body mismatch/,
  );
  globalThis.fetch = async () =>
    Response.json(
      { code: '42501', details: 'do-not-print', hint: null },
      { status: 403 },
    );
  await assert.rejects(
    assertDenied(local, '/rest/v1/profiles', 'token', {
      method: 'POST',
      httpStatus: 403,
      code: '42501',
    }),
    (error) => {
      assert.ok(!error.message.includes('do-not-print'));
      return /values suppressed/.test(error.message);
    },
  );
  globalThis.fetch = async () =>
    Response.json(
      { code: '23503', details: null, hint: null },
      { status: 409 },
    );
  await assert.rejects(
    assertDenied(local, '/rest/v1/profiles', 'token', {
      method: 'POST',
      httpStatus: 403,
      code: '42501',
    }),
    /denial status/,
  );
  globalThis.fetch = async () =>
    Response.json(
      { code: '23503', details: null, hint: null },
      { status: 403 },
    );
  await assert.rejects(
    assertDenied(local, '/rest/v1/profiles', 'token', {
      method: 'POST',
      httpStatus: 403,
      code: '42501',
    }),
    /denial code mismatch/,
  );
});
