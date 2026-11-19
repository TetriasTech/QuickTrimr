// Disposable local synthetic users and a synthetic address; no hosted provider calls.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

import { apiJson, makeUsers } from './api-test-helpers.mjs';
import { sqlValue } from './core-fixtures.mjs';
import { localStatus } from './local-api.mjs';
import { queryLocal } from './verify.mjs';
export async function availabilityMobileFixtures({ native = false } = {}) {
  const status = localStatus();
  const { users, tokens } = await makeUsers(status, {
    additional: ['admin', 'unprofiled'],
    adversarialMetadata: true,
  });
  try {
    if (native) {
      const email = 'available-' + randomUUID() + '@example.invalid',
        password = randomUUID() + randomUUID();
      const created = await apiJson(
        status,
        '/auth/v1/admin/users',
        status.SERVICE_ROLE_KEY,
        {
          method: 'POST',
          body: JSON.stringify({ email, password, email_confirm: true }),
        },
      );
      assert.equal(created.status, 200);
      users.native = created.body.id;
      const login = await apiJson(
        status,
        '/auth/v1/token?grant_type=password',
        status.ANON_KEY,
        { method: 'POST', body: JSON.stringify({ email, password }) },
      );
      assert.equal(login.status, 200);
      tokens.native = login.body.access_token;
      writeFileSync(
        '/private/tmp/quicktrimr45-native.json',
        JSON.stringify({ email, password, userId: users.native }),
        { mode: 0o600 },
      );
    }
    const post = (path, token, body) =>
      apiJson(status, path, token, {
        method: 'POST',
        body: JSON.stringify(body),
      });
    for (const name of [
      'clientA',
      'clientB',
      'barberA',
      'barberB',
      ...(native ? ['native'] : []),
    ])
      assert.equal(
        (
          await post('/functions/v1/create-or-sync-profile', tokens[name], {
            role: name.startsWith('client') ? 'client' : 'barber',
          })
        ).status,
        200,
      );
    queryLocal(`insert into public.profiles(id,role,verification_status) values('${users.admin}','admin','not_started');
 insert into public.public_areas(id,code,label,vintage,source_url,attribution,archive_sha256,boundary) values('sal:9998:qa-mobile','qa-mobile','QA Mobile Area',9998,'https://example.invalid/qa','Synthetic QA only','${'a'.repeat(64)}','SRID=4326;MULTIPOLYGON(((155 -44,156 -44,156 -43,155 -43,155 -44)))') on conflict(id) do nothing;`);
    const directoryId = 'QAAN' + randomUUID().replaceAll('-', '').slice(0, 20);
    const searchText = 'QAZX' + directoryId.slice(-6);
    queryLocal(
      `insert into private.address_directory(id,line1,line1_long,suburb,state,postcode,unit,location) values(${sqlValue(directoryId)},${sqlValue('1 ' + searchText + ' Street')},${sqlValue('1 ' + searchText + ' Street')},'Synthetic','ACT','2600','','SRID=4326;POINT(155.25 -43.5)');`,
    );
    for (const name of ['barberA', 'barberB', ...(native ? ['native'] : [])])
      queryLocal(`update public.profiles set verification_status='verified' where id='${users[name]}';
 insert into private.stripe_connect_accounts(barber_id,platform_account_id,stripe_account_id,account_status,charges_enabled,payouts_enabled) values('${users[name]}','acct_LocalFixturePlatform','acct_LocalFixture${randomUUID().replaceAll('-', '')}','verified',true,true);`);
    if (native) {
      const credentials = JSON.parse(
        readFileSync('/private/tmp/quicktrimr45-native.json', 'utf8'),
      );
      writeFileSync(
        '/private/tmp/quicktrimr45-native.json',
        JSON.stringify({ ...credentials, directoryId, searchText }),
        { mode: 0o600 },
      );
    }
    const read = (token = tokens.barberA, search = '') =>
      apiJson(
        status,
        '/functions/v1/start-available-now-session' + search,
        token,
        { method: 'GET' },
      );
    const write = (op, input, token = tokens.barberA) =>
      post('/functions/v1/' + op + '-available-now-session', token, input);
    const input = {
      directoryId,
      locationSource: 'manual',
      radiusKm: 8,
      availableUntil: new Date(Date.now() + 3600000).toISOString(),
    };
    const cleanup = async () => {
      const disposable = Object.entries(users)
        .filter(([name]) => name !== 'native')
        .map(([, id]) => id);
      queryLocal(
        `update public.available_now_sessions set status='cancelled' where barber_id in (${disposable.map(sqlValue).join(',')}) and status='active';`,
      );
      for (const id of disposable)
        assert.equal(
          (
            await apiJson(
              status,
              '/auth/v1/admin/users/' + id,
              status.SERVICE_ROLE_KEY,
              {
                method: 'DELETE',
                body: JSON.stringify({ should_soft_delete: true }),
              },
            )
          ).status,
          200,
        );
    };
    return {
      status,
      users,
      tokens,
      directoryId,
      searchText,
      read,
      write,
      post,
      input,
      cleanup,
    };
  } catch (error) {
    const cleanup = await Promise.allSettled(
      Object.values(users).map((id) =>
        apiJson(status, '/auth/v1/admin/users/' + id, status.SERVICE_ROLE_KEY, {
          method: 'DELETE',
          body: JSON.stringify({ should_soft_delete: true }),
        }),
      ),
    );
    if (cleanup.some((r) => r.status !== 'fulfilled' || r.value.status !== 200))
      throw new Error(
        'Local fixture setup failed; disposable-login cleanup was incomplete.',
      );
    throw error;
  }
}

// Real test barrier; only the fixed local QuickTrimr container is reachable.
export async function holdAvailabilityProfile(userId) {
  assert.match(userId, /^[0-9a-f-]{36}$/);
  const child = spawn(
    'docker',
    [
      'exec',
      '-i',
      'supabase_db_quicktrimr',
      'psql',
      '-X',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-At',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );
  const finished = new Promise((resolve, reject) => {
    child.on('error', () => reject(new Error('Local lock process failed')));
    child.on('exit', (code) =>
      code === 0
        ? resolve()
        : reject(new Error('Local lock transaction failed')),
    );
  });
  let timer;
  let output = '';
  const ready = new Promise((resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error('Local lock not acquired')),
      5000,
    );
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
      if (output.includes('QA_LOCK_HELD')) resolve();
    });
  });
  child.stdin.write(
    `begin;select 1 from public.profiles where id='${userId}' for update;\n\\echo QA_LOCK_HELD\n`,
  );
  try {
    await ready;
  } catch (error) {
    child.stdin.end('rollback;\n');
    await finished.catch(() => undefined);
    throw error;
  } finally {
    clearTimeout(timer);
  }
  return async (sql = '') => {
    child.stdin.end(sql + ';commit;\n');
    await finished;
  };
}
