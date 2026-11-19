import { availabilityApi } from '../src/features/availability/availability-api';

import type { SupabaseClient } from '@supabase/supabase-js';
const userId = '60499711-52d4-46c7-beb1-6d2c46937ed5';
const id = '68293ef1-2954-463d-89bd-48ab1f2b7d15';
const input = {
  directoryId: 'GAACTTEST001',
  locationSource: 'manual' as const,
  radiusKm: 2.5,
  availableUntil: '2026-11-20T20:00:00Z',
};
const state = {
  serverNow: '2026-11-20T08:00:00Z',
  config: { minRadiusKm: 1, maxRadiusKm: 50, maxHours: 12 },
  onboardingEligible: true,
  reliability: {
    level: 'good_standing',
    cooldownUntil: null,
    recoveryEligibleAt: null,
    reviewRequired: false,
    requiresHumanReinstatement: false,
    availableNowAllowed: true,
  },
  session: null,
};
const result = {
  id,
  status: 'active',
  radiusKm: 2.5,
  availableUntil: input.availableUntil,
  locationSource: 'manual',
  approximateArea: { id: 'sal:example', label: 'Synthetic' },
};
const sessionFor = (id: string) => ({
  data: { session: { user: { id }, access_token: 'fixture-token' } },
  error: null,
});
function fixture(data: unknown = state) {
  const currentSession = jest.fn(async () => sessionFor(userId));
  const invoke = jest
    .fn<
      Promise<{ data: unknown; error: null }>,
      [
        string,
        {
          body?: unknown;
          method?: string;
          headers: Record<string, string>;
          signal?: AbortSignal;
        },
      ]
    >()
    .mockResolvedValue({ data, error: null });
  const supabase = {
    auth: { getSession: currentSession },
    functions: { invoke },
  } as unknown as SupabaseClient;
  return { api: availabilityApi(supabase, userId), currentSession, invoke };
}
test('owner state uses a cancellable GET and bearer, with no client-selected owner or query', async () => {
  const f = fixture(),
    signal = new AbortController().signal;
  expect(await f.api.read(signal)).toEqual(state);
  expect(f.invoke).toHaveBeenCalledWith('start-available-now-session', {
    method: 'GET',
    headers: { Authorization: 'Bearer fixture-token' },
    signal,
  });
});
test('manual start and location-preserving update reuse strict shared contracts and verify response IDs', async () => {
  const f = fixture(result);
  expect(await f.api.start(input)).toEqual(result);
  expect(JSON.parse(f.invoke.mock.calls[0]![1].body as string)).toEqual(input);
  await f.api.update({
    sessionId: id,
    keepLocation: true,
    radiusKm: 2.5,
    availableUntil: input.availableUntil,
  });
  expect(JSON.parse(f.invoke.mock.calls[1]![1].body as string)).toEqual({
    sessionId: id,
    keepLocation: true,
    radiusKm: 2.5,
    availableUntil: input.availableUntil,
  });
  const wrong = fixture({ ...result, id: userId });
  await expect(
    wrong.api.update({
      sessionId: id,
      keepLocation: true,
      radiusKm: 2.5,
      availableUntil: input.availableUntil,
    }),
  ).rejects.toThrow('Unexpected session');
  const stop = fixture({ id: userId, status: 'manually_disabled' });
  await expect(stop.api.stop(id)).rejects.toThrow('Unexpected session');
});
test('account switches before I/O or while waiting never return a previous user response', async () => {
  const before = fixture();
  before.currentSession.mockResolvedValue(sessionFor('other-user'));
  await expect(before.api.read(new AbortController().signal)).rejects.toThrow(
    'Session changed',
  );
  expect(before.invoke).not.toHaveBeenCalled();
  for (const operation of ['read', 'start'] as const) {
    const after = fixture(operation === 'read' ? state : result);
    after.currentSession
      .mockResolvedValueOnce(sessionFor(userId))
      .mockResolvedValueOnce(sessionFor('other-user'));
    await expect(
      operation === 'read'
        ? after.api.read(new AbortController().signal)
        : after.api.start(input),
    ).rejects.toThrow('Session changed');
  }
});
test('aborted reads, private projection additions and network failures never produce fixture fallbacks', async () => {
  const controller = new AbortController();
  controller.abort();
  const f = fixture();
  await expect(f.api.read(controller.signal)).rejects.toThrow(
    'Session changed',
  );
  expect(f.invoke).not.toHaveBeenCalled();
  await expect(
    fixture({ ...state, lat: -37.8 }).api.read(new AbortController().signal),
  ).rejects.toThrow();
  const offline = fixture();
  offline.invoke.mockRejectedValue(new Error('network'));
  await expect(offline.api.read(new AbortController().signal)).rejects.toThrow(
    'network',
  );
});
