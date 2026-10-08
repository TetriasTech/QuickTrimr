import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { fixturePage } from './admin-fixture-data.mjs';

test('fixture transport returns one projected, sorted/filtered seed page; rejects unbounded/malformed queries', () => {
  const first = fixturePage(
    new URLSearchParams('page=0&size=5&sort=status&direction=asc'),
  );
  assert.equal(first.rowCount, 24);
  assert.equal(first.rows.length, 5);
  assert.deepEqual(Object.keys(first.rows[0]), ['id', 'status', 'gross_cents']);
  const second = fixturePage(
    new URLSearchParams('page=1&size=5&sort=status&direction=asc'),
  );
  assert.equal(
    second.rows.some((r) => first.rows.some((f) => f.id === r.id)),
    false,
  );
  const filtered = fixturePage(
    new URLSearchParams('status=accepted_pending_payment'),
  );
  assert.equal(filtered.rowCount, 2);
  assert.ok(
    filtered.rows.every((r) => r.status === 'accepted_pending_payment'),
  );
  assert.deepEqual(fixturePage(new URLSearchParams('status=no_matches')), {
    rows: [],
    rowCount: 0,
  });
  for (const query of [
    'size=9999',
    'page=-1',
    'page=0.5',
    'sort=client_address',
    'direction=other',
    'status=bad',
  ])
    assert.equal(fixturePage(new URLSearchParams(query)), null);
});
test('fixture server stays outside production routes, fixed loopback, without DB/env/target access', async () => {
  const source = await readFile(
    new URL('./admin-fixture-server.mjs', import.meta.url),
    'utf8',
  );
  assert.match(source, /server\.listen\(3101, '127\.0\.0\.1'/);
  assert.doesNotMatch(
    source,
    /queryLocal|localStatus|process\.env|\.env|SUPABASE_|stripe/i,
  );
  for (const path of [
    '../../apps/admin/app/(admin)/layout.tsx',
    '../../apps/admin/app/(admin)/page.tsx',
    '../../apps/admin/next.config.ts',
    '../../apps/admin/src/lib/auth/session.ts',
  ]) {
    const file = await readFile(new URL(path, import.meta.url), 'utf8');
    assert.doesNotMatch(file, /fixture|3101|preview/i);
  }
});
