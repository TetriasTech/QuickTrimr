import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

// Only disposable local credentials, supplied by the fixed localStatus lookup.
// Do not log headers, Auth bodies, protected rows or this status object.
export async function apiRequest(status, path, token, options = {}) {
  assert.equal(
    status.API_URL,
    'http://127.0.0.1:55321',
    'Refusing a non-QuickTrimr API.',
  );
  const url = new URL(path, status.API_URL);
  assert.equal(url.origin, status.API_URL, 'Refusing a cross-origin API path.');
  assert.ok(
    !url.username && !url.password,
    'API URL credentials are not accepted.',
  );
  assert.ok(
    options.body === undefined || typeof options.body === 'string',
    'Serialize JSON request bodies before calling apiJson.',
  );
  return fetch(url, {
    ...options,
    headers: {
      apikey: status.ANON_KEY,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      'content-type': 'application/json',
      prefer: 'return=representation',
      ...options.headers,
    },
    signal: AbortSignal.timeout(10000),
    redirect: 'error',
  });
}

export async function apiJson(status, path, token, options = {}) {
  const response = await apiRequest(status, path, token, options);
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(
      `Local ${options.method ?? 'GET'} returned non-JSON (${response.status}); body suppressed.`,
    );
  }
  return { status: response.status, body };
}

export function assertRawBody(actual, expected, label) {
  // Assert every field without printing private fixtures if the check fails.
  assert.ok(
    isDeepStrictEqual(actual, expected),
    `${label}: raw body mismatch; values suppressed.`,
  );
}

export async function assertDenied(
  status,
  path,
  token,
  { method = 'GET', body, httpStatus = 200, code } = {},
) {
  const result = await apiJson(status, path, token, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert.equal(
    result.status,
    httpStatus,
    `${method} ${path.split('?')[0]}: denial status.`,
  );
  if (httpStatus === 200) assertRawBody(result.body, [], `${method} denial`);
  else {
    assert.ok(
      result.body.code === code,
      `${method}: denial code mismatch; values suppressed.`,
    );
    assert.ok(
      result.body.details === null,
      `${method}: denial has data details; values suppressed.`,
    );
    assert.ok(
      result.body.hint === null,
      `${method}: denial has data hint; values suppressed.`,
    );
  }
  return result;
}

export async function makeUsers(
  status,
  { additional = [], adversarialMetadata = false } = {},
) {
  const users = {};
  const tokens = {};
  const names = [
    ...additional,
    'clientA',
    'clientB',
    'barberA',
    'barberB',
    'candidateClient',
    'candidateBarber',
    'candidateProfile',
  ];
  const authenticated = new Set([
    ...additional,
    'clientA',
    'clientB',
    'barberA',
    'barberB',
  ]);
  for (const name of names) {
    const email = `core-${randomUUID()}@example.invalid`;
    const password = randomUUID() + randomUUID();
    const created = await apiJson(
      status,
      '/auth/v1/admin/users',
      status.SERVICE_ROLE_KEY,
      {
        method: 'POST',
        body: JSON.stringify({
          email,
          password,
          email_confirm: true,
          ...(adversarialMetadata && name === 'barberA'
            ? { app_metadata: { role: 'admin' } }
            : {}),
        }),
      },
    );
    assert.equal(
      created.status,
      200,
      'Disposable local user creation failed; body suppressed.',
    );
    assert.match(created.body.id ?? '', /^[0-9a-f-]{36}$/);
    users[name] = created.body.id;
    if (!authenticated.has(name)) continue;
    const login = async () => {
      const result = await apiJson(
        status,
        '/auth/v1/token?grant_type=password',
        status.ANON_KEY,
        {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        },
      );
      assert.equal(
        result.status,
        200,
        'Local authentication failed; body suppressed.',
      );
      assert.equal(
        result.body.user?.id,
        users[name],
        'Login returned the wrong fixture user.',
      );
      assert.ok(
        typeof result.body.access_token === 'string',
        'Local user JWT missing.',
      );
      return result.body;
    };
    let session = await login();
    if (adversarialMetadata && name === 'clientA') {
      // This is a real client-authorised metadata update, followed by a fresh
      // signed GoTrue JWT. It is not an unsigned/faked token that auth just rejects.
      const changed = await apiJson(
        status,
        '/auth/v1/user',
        session.access_token,
        {
          method: 'PUT',
          body: JSON.stringify({
            data: { role: 'admin', user_id: users.admin },
          }),
        },
      );
      assert.equal(changed.status, 200, 'Local user-metadata update failed.');
      session = await login();
      assert.equal(session.user.user_metadata.role, 'admin');
    }
    if (adversarialMetadata && name === 'barberA')
      assert.equal(session.user.app_metadata.role, 'admin');
    tokens[name] = session.access_token;
  }
  return { users, tokens };
}
