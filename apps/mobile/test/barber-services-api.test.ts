import { upsertBarberServiceRequestSchema } from '@quicktrimr/validation';

import {
  barberServicesApi,
  SERVICE_CATALOGUE_PAGE_SIZE,
} from '../src/features/services/barber-services-api';

import type { SupabaseClient } from '@supabase/supabase-js';

const userId = '60499711-52d4-46c7-beb1-6d2c46937ed5';
const categoryId = '8f293ef1-2954-463d-89bd-48ab1f2b7d15';
const serviceId = '68293ef1-2954-463d-89bd-48ab1f2b7d15';
const request = upsertBarberServiceRequestSchema.parse({
  serviceCategoryId: categoryId,
  priceCents: 4550,
  enabled: true,
});
const sessionFor = (id: string) => ({
  data: { session: { user: { id }, access_token: 'fixture-user-token' } },
  error: null,
});
function fixture() {
  const currentSession = jest.fn(async () => sessionFor(userId));
  const response = {
    data: { id: serviceId, ...request, archivedAt: null },
    error: null,
  };
  const invoke = jest
    .fn<
      Promise<typeof response>,
      [string, { headers: Record<string, string>; body: string }]
    >()
    .mockResolvedValue(response);
  const calls: [string, unknown][] = [];
  let rows: unknown = [];
  type Builder = {
    select(value: string): Builder;
    is(column: string, value: null): Builder;
    eq(column: string, value: string): Builder;
    order(column: string): Builder;
    range(start: number, end: number): Builder;
    abortSignal(signal: AbortSignal): Promise<{ data: unknown; error: null }>;
  };
  const builder: Builder = {
    select(value) {
      calls.push(['select', value]);
      return builder;
    },
    is(column, value) {
      calls.push(['is', [column, value]]);
      return builder;
    },
    eq(column, value) {
      calls.push(['eq', [column, value]]);
      return builder;
    },
    order(column) {
      calls.push(['order', column]);
      return builder;
    },
    range(start, end) {
      calls.push(['range', [start, end]]);
      return builder;
    },
    async abortSignal() {
      return { data: rows, error: null };
    },
  };
  const from = jest.fn(() => builder);
  const supabase = {
    auth: { getSession: currentSession },
    functions: { invoke },
    from,
  } as unknown as SupabaseClient;
  return {
    api: barberServicesApi(supabase, userId),
    currentSession,
    invoke,
    from,
    calls,
    setRows(value: unknown) {
      rows = value;
    },
  };
}
test('list is one joined bounded page with explicit owner filter and stable order', async () => {
  const f = fixture();
  expect(
    await f.api.page(SERVICE_CATALOGUE_PAGE_SIZE, new AbortController().signal),
  ).toEqual([]);
  expect(f.from).toHaveBeenCalledTimes(1);
  expect(f.calls).toContainEqual(['eq', ['services.barber_id', userId]]);
  expect(f.calls).toContainEqual([
    'range',
    [SERVICE_CATALOGUE_PAGE_SIZE, 2 * SERVICE_CATALOGUE_PAGE_SIZE - 1],
  ]);
  expect(f.calls.filter(([name]) => name === 'order')).toEqual([
    ['order', 'display_order'],
    ['order', 'slug'],
    ['order', 'id'],
  ]);
});
test('price mutation carries integer cents and the current bearer, with no client owner field', async () => {
  const f = fixture();
  expect((await f.api.upsert(request)).priceCents).toBe(4550);
  const sent = f.invoke.mock.calls[0]![1];
  expect(JSON.parse(sent.body)).toEqual(request);
  expect(sent.headers.Authorization).toBe('Bearer fixture-user-token');
});
test('session changes before a call prevent any I/O, and late responses cannot repopulate the new account', async () => {
  const before = fixture();
  before.currentSession.mockResolvedValue(sessionFor('different-user'));
  await expect(before.api.upsert(request)).rejects.toThrow('Session changed');
  expect(before.invoke).not.toHaveBeenCalled();
  await expect(
    before.api.page(0, new AbortController().signal),
  ).rejects.toThrow('Session changed');
  expect(before.from).not.toHaveBeenCalled();
  const after = fixture();
  after.currentSession
    .mockResolvedValueOnce(sessionFor(userId))
    .mockResolvedValueOnce(sessionFor('different-user'));
  await expect(after.api.upsert(request)).rejects.toThrow('Session changed');
  const read = fixture();
  read.currentSession
    .mockResolvedValueOnce(sessionFor(userId))
    .mockResolvedValueOnce(sessionFor('different-user'));
  await expect(read.api.page(0, new AbortController().signal)).rejects.toThrow(
    'Session changed',
  );
});
test('unexpected catalogue fields or mismatched category responses fail closed', async () => {
  const f = fixture();
  f.setRows([{ private_field: 'synthetic-fixture' }]);
  await expect(f.api.page(0, new AbortController().signal)).rejects.toThrow();
  f.invoke.mockResolvedValue({
    data: {
      id: serviceId,
      ...request,
      serviceCategoryId: serviceId,
      archivedAt: null,
    },
    error: null,
  });
  await expect(f.api.upsert(request)).rejects.toThrow(
    'Unexpected service response',
  );
});
