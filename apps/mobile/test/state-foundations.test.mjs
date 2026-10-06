import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { BOOKING_TYPE_VALUE } from '@quicktrimr/shared';
import { CONTRACT_EXAMPLES } from '@quicktrimr/validation';

import {
  EdgeFunctionError,
  invokeEdgeFunction,
} from '../src/lib/api/invoke-edge-function.ts';
import {
  createQueryClient,
  shouldRetryQuery,
} from '../src/lib/query/query-client.ts';
import { queryKeys } from '../src/lib/query/query-keys.ts';
import { useBookingDraftStore } from '../src/stores/booking-draft-store.ts';

const mobileRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return ['.ts', '.tsx'].includes(extname(path)) ? [path] : [];
    }),
  );
  return nested.flat();
}

test('the Edge Function helper surfaces the typed shared error envelope on 422', async () => {
  const request = CONTRACT_EXAMPLES['create-booking-request'].request.valid;
  const expectedError = {
    error: 'The booking request is invalid',
    fields: { barberId: 'Select an available barber' },
  };
  let invocation;

  const transport = {
    async invoke(functionName, options) {
      invocation = { functionName, options };
      return { status: 422, body: expectedError };
    },
  };

  await assert.rejects(
    invokeEdgeFunction(transport, 'create-booking-request', request),
    (error) => {
      assert.equal(error instanceof EdgeFunctionError, true);
      assert.equal(error.status, 422);
      assert.deepEqual(error.response, expectedError);
      assert.equal(error.message, expectedError.error);
      return true;
    },
  );

  assert.deepEqual(invocation, {
    functionName: 'create-booking-request',
    options: { body: request },
  });
});

test('the Edge Function helper validates successful responses with the named contract', async () => {
  const examples = CONTRACT_EXAMPLES['create-booking-request'];
  const result = await invokeEdgeFunction(
    {
      async invoke() {
        return { status: 201, body: examples.response.valid };
      },
    },
    'create-booking-request',
    examples.request.valid,
  );

  assert.deepEqual(result, examples.response.valid);
});

test('the query-key factory produces stable, hierarchical keys', () => {
  assert.deepEqual(queryKeys.bookings.detail('booking-1'), [
    'bookings',
    'detail',
    'booking-1',
  ]);
  assert.deepEqual(
    queryKeys.bookings.detail('booking-1'),
    queryKeys.bookings.detail('booking-1'),
  );
  assert.deepEqual(queryKeys.bookings.eta('booking-1').slice(0, 3), [
    'bookings',
    'detail',
    'booking-1',
  ]);
  assert.deepEqual(queryKeys.platformConfig.scheduling(), [
    'platform-config',
    'scheduling',
  ]);
  assert.deepEqual(
    queryKeys.discovery.results({ radiusKm: 8, service: 'fade' }),
    queryKeys.discovery.results({ service: 'fade', radiusKm: 8 }),
  );
});

test('the Query client defaults refresh server truth without retrying client errors', () => {
  const defaults = createQueryClient().getDefaultOptions();

  assert.equal(defaults.queries.staleTime, 0);
  assert.equal(defaults.queries.refetchOnWindowFocus, true);
  assert.equal(defaults.queries.refetchOnReconnect, true);
  assert.equal(defaults.mutations.retry, false);
  assert.equal(shouldRetryQuery(0, { status: 422 }), false);
  assert.equal(shouldRetryQuery(0, { status: 500 }), true);
  assert.equal(shouldRetryQuery(1, new Error('offline')), false);
});

test('the booking draft store contains only the four allowed local selections', () => {
  const store = useBookingDraftStore.getState();
  const dataKeys = Object.keys(store).filter(
    (key) => typeof store[key] !== 'function',
  );

  assert.deepEqual(dataKeys.sort(), [
    'selectedAddressId',
    'selectedBarberId',
    'selectedBookingType',
    'selectedServiceCategoryId',
  ]);

  const savedDraft = {
    selectedAddressId: 'address-1',
    selectedBarberId: 'barber-1',
    selectedBookingType: BOOKING_TYPE_VALUE.AVAILABLE_NOW,
    selectedServiceCategoryId: 'service-1',
  };
  store.replaceDraft(savedDraft);
  assert.deepEqual(
    Object.fromEntries(
      dataKeys.map((key) => [key, useBookingDraftStore.getState()[key]]),
    ),
    savedDraft,
  );

  useBookingDraftStore.getState().resetDraft();
  for (const key of dataKeys)
    assert.equal(useBookingDraftStore.getState()[key], null);
});

test('query keys are constructed only in the query-key factory', async () => {
  const root = resolve(mobileRoot, 'src');
  const factoryPath = resolve(root, 'lib/query/query-keys.ts');

  for (const path of await sourceFiles(root)) {
    if (path === factoryPath) continue;
    const source = await readFile(path, 'utf8');
    assert.doesNotMatch(source, /queryKey\s*:\s*\[/, path);
    assert.doesNotMatch(
      source,
      /invalidateQueries\s*\(\s*\{\s*queryKey\s*:\s*\[/,
      path,
    );
  }
});

test('the real form uses React Hook Form with the shared Zod schema', async () => {
  const source = await readFile(
    resolve(
      mobileRoot,
      'src/features/booking-draft/screens/booking-draft-form-screen.tsx',
    ),
    'utf8',
  );

  assert.match(source, /useForm<CreateBookingRequestRequest>/);
  assert.match(source, /zodResolver\(createBookingRequestRequestSchema\)/);
});
