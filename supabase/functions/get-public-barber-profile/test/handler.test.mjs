import assert from 'node:assert/strict';
import test from 'node:test';

import { barberPhotoLimits } from '@quicktrimr/shared';
import { API_FIXTURES } from '@quicktrimr/validation/fixtures';

import { createPublicBarberProfileHandler } from '../handler.ts';

const clientId = '22222222-2222-4222-8222-222222222222';
const profile = API_FIXTURES['get-public-barber-profile'].response.profile;
function fixture({
  role = 'client',
  authStatus = 200,
  rpcStatus = 200,
  result,
  photoStatus = 200,
} = {}) {
  const calls = [],
    logs = [];
  const { photoUrl: ignored, ...publicFields } = profile;
  assert.equal(ignored, null);
  const handler = createPublicBarberProfileHandler({
    supabaseUrl: 'http://127.0.0.1:55321',
    anonKey: 'anon-fixture',
    serviceRoleKey: 'service-fixture',
    log: { error: (tag) => logs.push(tag) },
    async fetcher(input, options) {
      const url = new URL(input);
      calls.push({ url, options });
      if (url.pathname === '/auth/v1/user')
        return Response.json(
          {
            id: clientId,
            role: 'authenticated',
            user_metadata: { role: 'client' },
          },
          { status: authStatus },
        );
      if (url.pathname === '/rest/v1/profiles')
        return Response.json(role ? [{ role }] : []);
      if (url.pathname.startsWith('/storage/v1/'))
        return Response.json(
          {
            signedURL:
              url.pathname.slice('/storage/v1'.length) + '?token=synthetic',
          },
          { status: photoStatus },
        );
      assert.equal(url.pathname, '/rest/v1/rpc/get_public_barber_profile');
      return Response.json(result ?? { profile: publicFields, photoId: null }, {
        status: rpcStatus,
      });
    },
  });
  return {
    calls,
    logs,
    invoke: (body = { barberId: profile.barberId }, authorized = true) =>
      handler(
        new Request('http://localhost/profile', {
          method: 'POST',
          headers: {
            ...(authorized ? { authorization: 'Bearer test-user' } : {}),
            'content-type': 'application/json',
          },
          body: typeof body === 'string' ? body : JSON.stringify(body),
        }),
      ),
  };
}
test('verified JWT supplies caller; strict public response and one bounded RPC', async () => {
  const f = fixture();
  const response = await f.invoke({
    barberId: profile.barberId,
    userId: 'forged',
    amountCents: 1,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { profile });
  assert.deepEqual(JSON.parse(f.calls.at(-1).options.body), {
    p_client_id: clientId,
    p_barber_id: profile.barberId,
    p_after: null,
    p_service_category_id: null,
  });
  assert.equal(f.calls.length, 3);
});
test('no token, invalid token, wrong stored roles and unprofiled callers fail before data', async () => {
  const missing = fixture();
  assert.equal((await missing.invoke(undefined, false)).status, 401);
  assert.equal(missing.calls.length, 0);
  const invalid = fixture({ authStatus: 401 });
  assert.equal((await invalid.invoke()).status, 401);
  for (const role of ['barber', 'admin', null]) {
    const f = fixture({ role });
    assert.equal((await f.invoke()).status, 403);
    assert.equal(f.calls.length, 2);
  }
});
test('malformed UUID, cursor, extra private input and broken JSON give field-level rejection', async () => {
  for (const input of [
    { barberId: 'bad' },
    { barberId: profile.barberId, servicesAfter: {} },
    { barberId: profile.barberId, service_area: [1, 2] },
    '{',
  ]) {
    const f = fixture();
    const response = await f.invoke(input);
    assert.equal(response.status, 422);
    const body = await response.json();
    assert.equal(body.error, 'validation_failed');
    assert.ok(Object.keys(body.fields).length);
    assert.equal(f.calls.length, 2);
  }
});
test('unknown/ineligible target is null; DB role recheck maps to forbidden', async () => {
  const f = fixture({ result: { profile: null, photoId: null } });
  assert.deepEqual(await (await f.invoke()).json(), { profile: null });
  const denied = fixture({
    rpcStatus: 403,
    result: { message: 'public_profile_forbidden' },
  });
  assert.equal((await denied.invoke()).status, 403);
});
test('each extra private field fails closed rather than reaching the response or logs', async () => {
  const { photoUrl: ignored, ...fields } = profile;
  assert.equal(ignored, null);
  for (const key of [
    'service_area',
    'serviceRadiusKm',
    'email',
    'mobile',
    'photoId',
    'storagePath',
    'stripeAccountId',
    'verificationStatus',
    'onboardingComplete',
    'distance',
    'location',
  ]) {
    const f = fixture({
      result: {
        profile: { ...fields, [key]: 'sensitive-fixture' },
        photoId: null,
      },
    });
    const response = await f.invoke();
    assert.equal(response.status, 500, key);
    assert.deepEqual(await response.json(), { error: 'internal_error' });
    assert.deepEqual(f.logs, ['public_barber_profile.internal_error']);
  }
});
test('photo signing uses configured expiration and returns only the signed link', async () => {
  const { photoUrl: ignored, ...fields } = profile;
  assert.equal(ignored, null);
  const result = { profile: fields, photoId: 'a'.repeat(64) };
  const f = fixture({ result });
  const response = await f.invoke();
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(f.calls.at(-1).options.body), {
    expiresIn: barberPhotoLimits.signedUrlSeconds,
  });
  const body = await response.json();
  assert.match(body.profile.photoUrl, /^\/storage\/v1\/object\/sign\//);
  assert.equal('photoId' in body.profile, false);
  const unavailable = fixture({ result, photoStatus: 500 });
  assert.equal((await unavailable.invoke()).status, 500);
});

test('selected category is bounded inside the same role-verified RPC, never a route price', async () => {
  const f = fixture({
    result: {
      photoId: null,
      profile: { ...profile, selectedService: profile.services[0] },
    },
  });
  const response = await f.invoke({
    barberId: profile.barberId,
    serviceCategoryId: profile.services[0].serviceCategoryId,
  });
  assert.equal(response.status, 200);
  assert.equal(
    (await response.json()).profile.selectedService.priceCents,
    profile.services[0].priceCents,
  );
  assert.equal(
    JSON.parse(f.calls.at(-1).options.body).p_service_category_id,
    profile.services[0].serviceCategoryId,
  );
  assert.equal(f.calls.length, 3);
});
