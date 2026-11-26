import assert from 'node:assert/strict';
import test from 'node:test';

import { requestDeadlineReached } from '../src/index.ts';

test('a request is eligible before its deadline and elapsed at and after it', () => {
  const deadline = Date.parse('2026-11-26T00:05:00Z');
  assert.equal(requestDeadlineReached(deadline, deadline - 1), false);
  assert.equal(requestDeadlineReached(deadline, deadline), true);
  assert.equal(requestDeadlineReached(deadline, deadline + 1), true);
});
