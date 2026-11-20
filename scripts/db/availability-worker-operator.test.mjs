import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  assertWorkerTarget,
  validateWorkerDsn,
  workerConfig,
} from '../availability/worker-operator.mjs';

test('monitor credentials are pinned to the approved destination and never disclosed by rejection', () => {
  const monitor = workerConfig('CFG-AVAIL-WORKER-MONITOR');
  const key = 'abcdef0123456789';
  const valid = `https://${key}@${monitor.ingestHost}/${monitor.projectId}`;
  assert.doesNotThrow(() => validateWorkerDsn(valid, monitor));
  for (const input of [
    `${key}invalid`,
    valid.replace('https:', 'http:'),
    valid.replace(monitor.ingestHost, 'other.example'),
    valid.replace(monitor.ingestHost, `${monitor.ingestHost}:8443`),
    valid.replace(monitor.projectId, '123'),
    `${valid}?secret=${key}`,
    valid.replace(`${key}@`, `${key}:password@`),
    `${valid}#${key}`,
  ]) {
    assert.throws(
      () => validateWorkerDsn(input, monitor),
      (error) => {
        assert.ok(!String(error).includes(key));
        assert.ok(!String(error).includes(input));
        return true;
      },
    );
  }
});

test('worker operator refuses a different linked project, organization, unavailable project or account', () => {
  const expected = { projectRef: 'intended-test', organizationId: 'customer' };
  const correct = {
    id: expected.projectRef,
    organization_id: expected.organizationId,
    status: 'ACTIVE_HEALTHY',
  };
  assert.doesNotThrow(() =>
    assertWorkerTarget([correct], expected.projectRef, expected),
  );
  assert.throws(() => assertWorkerTarget([correct], 'other-project', expected));
  assert.throws(() =>
    assertWorkerTarget(
      [{ ...correct, organization_id: 'other-owner' }],
      expected.projectRef,
      expected,
    ),
  );
  assert.throws(() =>
    assertWorkerTarget(
      [{ ...correct, status: 'INACTIVE' }],
      expected.projectRef,
      expected,
    ),
  );
  assert.throws(() => assertWorkerTarget([], expected.projectRef, expected));
});
test('worker migration values and monitor identity match the upstream approved configs', () => {
  const source = readFileSync(
    new URL(
      '../../supabase/migrations/20261120120000_available_now_transitions.sql',
      import.meta.url,
    ),
    'utf8',
  );
  const operations = JSON.parse(
    source.match(/'available_now_worker_operations','([^']+)'/)[1],
  );
  assert.deepEqual(operations, workerConfig('CFG-AVAIL-WORKER-OPERATIONS'));
  const worker = readFileSync(
    new URL(
      '../../supabase/migrations/20261120130000_available_now_worker.sql',
      import.meta.url,
    ),
    'utf8',
  );
  const monitor = JSON.parse(
    worker.match(/'available_now_worker_monitor','([^']+)'/)[1],
  );
  const approved = workerConfig('CFG-AVAIL-WORKER-MONITOR');
  for (const [key, value] of Object.entries(monitor))
    assert.equal(value, approved[key], key);
});
