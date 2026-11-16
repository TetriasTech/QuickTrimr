import assert from 'node:assert/strict';
import { test } from 'node:test';

import { authFailure, authMessages } from '../src/features/auth/auth-errors.ts';

test('wrong password and unknown email have the same public error', () => {
  for (const code of ['invalid_credentials', 'user_not_found']) {
    const reason = authFailure({ code, status: 400 });
    assert.equal(reason, 'invalid_credentials');
    assert.equal(authMessages[reason], 'The email or password is incorrect.');
  }
});

test('provider 429 and rate codes produce a generic rate-limit message', () => {
  for (const failure of [
    { status: 429 },
    { code: 'over_request_rate_limit' },
    { code: 'over_email_send_rate_limit' },
  ]) {
    assert.equal(authFailure(failure), 'too_many_attempts');
  }
  assert.equal(
    authMessages.too_many_attempts,
    'Too many attempts. Wait a moment and try again.',
  );
  assert.equal(
    authFailure({ status: 400, code: 'email_not_confirmed' }),
    'email_not_confirmed',
  );
});
