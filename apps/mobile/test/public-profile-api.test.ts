import { API_FIXTURES } from '@quicktrimr/validation/fixtures';
import { type SupabaseClient } from '@supabase/supabase-js';

import { publicProfileApi } from '../src/features/public-profiles/public-profile-api';

const response = API_FIXTURES['get-public-barber-profile'].response;
const barberId = response.profile!.barberId;
function fixture() {
  const session = (id = 'synthetic-client') => ({
    data: { session: { user: { id }, access_token: 'synthetic-token' } },
    error: null,
  });
  const getSession = jest.fn().mockResolvedValue(session());
  const invoke = jest.fn().mockResolvedValue({ data: response, error: null });
  const supabase = {
    auth: { getSession },
    functions: { invoke },
  } as unknown as SupabaseClient;
  return {
    getSession,
    invoke,
    session,
    api: publicProfileApi(supabase, 'synthetic-client', barberId),
  };
}
test('uses only the public contract with fresh bearer, selected barber and cancellation', async () => {
  const f = fixture();
  const signal = new AbortController().signal;
  expect(await f.api.page(undefined, signal)).toEqual(response);
  expect(f.invoke.mock.calls[0]![0]).toBe('get-public-barber-profile');
  const options = f.invoke.mock.calls[0]![1];
  expect(JSON.parse(options.body)).toEqual({ barberId });
  expect(options.headers.Authorization).toBe('Bearer synthetic-token');
  expect(options.signal).toBe(signal);
});
test('account change before or after fetch and cancellation reject instead of caching another session', async () => {
  const before = fixture();
  before.getSession.mockResolvedValue(before.session('another-client'));
  await expect(
    before.api.page(undefined, new AbortController().signal),
  ).rejects.toThrow('Session changed');
  expect(before.invoke).not.toHaveBeenCalled();
  const after = fixture();
  after.getSession
    .mockResolvedValueOnce(after.session())
    .mockResolvedValue(after.session('another-client'));
  await expect(
    after.api.page(undefined, new AbortController().signal),
  ).rejects.toThrow('Session changed');
  const cancelled = fixture();
  const controller = new AbortController();
  controller.abort();
  await expect(
    cancelled.api.page(undefined, controller.signal),
  ).rejects.toThrow('Session changed');
  expect(cancelled.invoke).not.toHaveBeenCalled();
});
test('public response rejects private fields, wrong target and invented cents', async () => {
  for (const profile of [
    { ...response.profile, serviceRadiusKm: 12 },
    { ...response.profile, barberId: '22222222-2222-4222-8222-222222222222' },
    {
      ...response.profile,
      services: [{ ...response.profile!.services[0], priceCents: 45.5 }],
    },
  ]) {
    const f = fixture();
    f.invoke.mockResolvedValue({ data: { profile }, error: null });
    await expect(
      f.api.page(undefined, new AbortController().signal),
    ).rejects.toThrow();
  }
});

test('canonical UUID case is accepted without changing target identity', async () => {
  const f = fixture();
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  f.invoke.mockResolvedValue({
    data: { profile: { ...response.profile, barberId: id } },
    error: null,
  });
  const api = publicProfileApi(
    {
      auth: { getSession: f.getSession },
      functions: { invoke: f.invoke },
    } as unknown as SupabaseClient,
    'synthetic-client',
    id.toUpperCase(),
  );
  expect(
    (await api.page(undefined, new AbortController().signal)).profile?.barberId,
  ).toBe(id);
  expect(JSON.parse(f.invoke.mock.calls[0]![1].body).barberId).toBe(id);
});

test('selected-category lookup carries only IDs and rejects a different or missing selected projection', async () => {
  const f = fixture();
  const selected = response.profile!.services[0]!;
  const api = publicProfileApi(
    {
      auth: { getSession: f.getSession },
      functions: { invoke: f.invoke },
    } as unknown as SupabaseClient,
    'synthetic-client',
    barberId,
    selected.serviceCategoryId,
  );
  f.invoke.mockResolvedValue({
    data: { profile: { ...response.profile, selectedService: selected } },
    error: null,
  });
  expect(
    (await api.page(undefined, new AbortController().signal)).profile!
      .selectedService!.priceCents,
  ).toBe(selected.priceCents);
  expect(JSON.parse(f.invoke.mock.calls[0]![1].body)).toEqual({
    barberId,
    serviceCategoryId: selected.serviceCategoryId,
  });
  for (const selectedService of [
    undefined,
    { ...selected, serviceCategoryId: '22222222-2222-4222-8222-222222222222' },
    { ...selected, priceCents: 45.5 },
    { ...selected, privateAddress: 'forged' },
  ]) {
    f.invoke.mockResolvedValue({
      data: { profile: { ...response.profile, selectedService } },
      error: null,
    });
    await expect(
      api.page(undefined, new AbortController().signal),
    ).rejects.toThrow();
  }
});
