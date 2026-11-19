// Synthetic, local-only facts. No Stripe calls or hosted-account verification.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

import { apiJson, makeUsers } from './api-test-helpers.mjs';
import { insertSql, sqlValue } from './core-fixtures.mjs';
import { localStatus } from './local-api.mjs';
import { queryLocal } from './verify.mjs';

export async function publicProfileFixtures() {
  const status = localStatus();
  const { users, tokens } = await makeUsers(status, {
    additional: ['admin', 'unprofiled'],
    adversarialMetadata: true,
  });
  const post = (path, token, input) =>
    apiJson(status, path, token, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  for (const [name, role] of [
    ['clientA', 'client'],
    ['clientB', 'client'],
    ['barberA', 'barber'],
    ['barberB', 'barber'],
  ]) {
    assert.equal(
      (
        await post('/functions/v1/create-or-sync-profile', tokens[name], {
          role,
        })
      ).status,
      200,
      'Bootstrap synthetic profile',
    );
  }
  queryLocal(
    insertSql('profiles', {
      id: users.admin,
      role: 'admin',
      verification_status: 'not_started',
    }),
  );
  const areaId = 'sal:2021:qa-' + randomUUID();
  const area = {
    id: areaId,
    code: areaId,
    label: 'QA Shared Locality',
    vintage: 2021,
    source_url: 'https://example.invalid/synthetic-sal',
    attribution: 'Synthetic test polygon, not a licensed production area.',
    archive_sha256: 'a'.repeat(64),
    boundary:
      'SRID=4326;MULTIPOLYGON(((144 -39,146 -39,146 -37,144 -37,144 -39)))',
  };
  queryLocal(
    `insert into public.public_areas (${Object.keys(area).join(',')}) values (${Object.values(area).map(sqlValue).join(',')});`,
  );
  for (const [index, name] of ['barberA', 'barberB'].entries()) {
    assert.equal(
      (
        await post('/functions/v1/complete-barber-profile', tokens[name], {
          displayName: 'Marcus Demo',
          bio: 'Synthetic mobile barber profile for QuickTrimr QA.',
          yearsExperience: 10,
          serviceAreaLat: -38.2 + index / 10,
          serviceAreaLng: 145.2,
          serviceRadiusKm: 12,
        })
      ).status,
      200,
      'Save synthetic barber public fields',
    );
    queryLocal(
      `insert into private.stripe_connect_accounts (barber_id,platform_account_id,stripe_account_id,account_status,charges_enabled,payouts_enabled)
      values (${sqlValue(users[name])},'acct_LocalFixturePlatform',${sqlValue('acct_LocalFixture' + randomUUID().replaceAll('-', ''))},'verified',true,true);` +
        `update public.profiles set verification_status='verified' where id=${sqlValue(users[name])};
        update public.barber_profiles set public_area_id=${sqlValue(areaId)} where id=${sqlValue(users[name])};`,
    );
  }
  const require = createRequire(
    new URL(
      '../../supabase/functions/complete-barber-profile/package.json',
      import.meta.url,
    ),
  );
  const { encode } = require('jpeg-js');
  const jpeg = encode(
    { width: 64, height: 64, data: new Uint8Array(64 * 64 * 4).fill(173) },
    80,
  ).data;
  const upload = await fetch(
    new URL('/functions/v1/complete-barber-profile/photo', status.API_URL),
    {
      method: 'POST',
      headers: {
        apikey: status.ANON_KEY,
        authorization: `Bearer ${tokens.barberA}`,
        'content-type': 'image/jpeg',
      },
      body: jpeg,
      signal: AbortSignal.timeout(10000),
    },
  );
  assert.equal(upload.status, 200, 'Synthetic photo upload');
  const { photoId } = await upload.json();
  assert.equal(
    (
      await post('/functions/v1/complete-barber-profile', tokens.barberA, {
        displayName: 'Marcus Demo',
        bio: 'Synthetic mobile barber profile for QuickTrimr QA.',
        yearsExperience: 10,
        serviceRadiusKm: 12,
        photoId,
      })
    ).status,
    200,
  );
  // Explicit projection fixture, not evidence for the separately tested P1-T06 resolver.
  queryLocal(
    `update public.barber_profiles set public_area_id=${sqlValue(areaId)} where id=${sqlValue(users.barberA)};`,
  );
  const createdCategories = [];
  const createService = async (index) => {
    const category = await post(
      '/functions/v1/create-service-category',
      tokens.admin,
      {
        slug: 'profile-fixture-' + randomUUID(),
        displayName: index === 0 ? 'Demo Haircut' : `Demo Service ${index + 1}`,
        description: 'Synthetic service for profile verification.',
        displayOrder: index,
        minPriceCents: 2000,
        maxPriceCents: 15000,
      },
    );
    assert.equal(category.status, 200, 'Synthetic category');
    createdCategories.push(category.body.id);
    const service = await post(
      '/functions/v1/upsert-barber-service',
      tokens.barberA,
      {
        serviceCategoryId: category.body.id,
        priceCents: 4550 + index,
        enabled: true,
      },
    );
    assert.equal(service.status, 200, 'Synthetic priced service');
    return { category: category.body, service: service.body };
  };
  const read = (barberId = users.barberA, token = tokens.clientA, after) =>
    post('/functions/v1/get-public-barber-profile', token, {
      barberId,
      ...(after ? { servicesAfter: after } : {}),
    });
  async function cleanup() {
    for (const id of createdCategories)
      assert.equal(
        (
          await post('/functions/v1/archive-service-category', tokens.admin, {
            id,
          })
        ).status,
        200,
        'Archive fixture category',
      );
    queryLocal(`update public.barber_profiles set public_area_id=null where id in (${sqlValue(users.barberA)},${sqlValue(users.barberB)});
      delete from public.public_areas where id=${sqlValue(areaId)};`);
    for (const id of Object.values(users)) {
      const deleted = await apiJson(
        status,
        '/auth/v1/admin/users/' + id,
        status.SERVICE_ROLE_KEY,
        {
          method: 'DELETE',
          body: JSON.stringify({ should_soft_delete: true }),
        },
      );
      assert.equal(
        deleted.status,
        200,
        'Soft-delete disposable Auth login; audit attribution retained',
      );
    }
  }
  return {
    status,
    users,
    tokens,
    areaId,
    photoId,
    jpeg,
    post,
    createService,
    read,
    cleanup,
  };
}
