import assert from 'node:assert/strict';
import test from 'node:test';

import { signBarberPhotos } from '../../profiles/signed-photo.ts';
const one = '91f09000-0000-4000-8000-000000000001',
  two = '91f09000-0000-4000-8000-000000000002',
  photo = 'a'.repeat(64);
test('discovery signs one bounded deduplicated batch and validates response paths', async () => {
  let calls = 0,
    bad = false;
  const options = {
    baseUrl: new URL('http://127.0.0.1:55321'),
    serviceRoleKey: 'server-fixture',
    photos: [
      { userId: one, photoId: photo },
      { userId: two, photoId: null },
      { userId: one, photoId: photo },
    ],
    fetcher: async (url, request) => {
      calls++;
      assert.equal(
        new URL(url).pathname,
        '/storage/v1/object/sign/barber-avatars',
      );
      const body = JSON.parse(request.body);
      assert.equal(body.paths.length, 1);
      return Response.json(
        body.paths.map((path) => ({
          path,
          signedURL: bad
            ? 'https://untrusted.invalid/secret'
            : `/object/sign/barber-avatars/${path}?token=fixture`,
          error: null,
        })),
      );
    },
  };
  const urls = await signBarberPhotos(options);
  assert.equal(calls, 1);
  assert.equal(urls[0], urls[2]);
  assert.equal(urls[1], null);
  assert.deepEqual(await signBarberPhotos({ ...options, photos: [] }), []);
  assert.equal(calls, 1);
  bad = true;
  await assert.rejects(signBarberPhotos(options), /Photo batch signing failed/);
});
