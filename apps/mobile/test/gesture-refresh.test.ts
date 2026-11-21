import { createGestureRefresh } from '../src/features/discovery/gesture-refresh';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
test('continuous drag fires no requests; completed gestures coalesce at the exact interval and never refresh while dragging', async () => {
  const refresh = jest.fn(async () => {}),
    fail = jest.fn();
  const s = createGestureRefresh({ intervalMs: 2000, refresh, onError: fail });
  for (let i = 0; i < 100; i++) {
    s.begin();
    jest.advanceTimersByTime(10);
  }
  expect(refresh).not.toHaveBeenCalled();
  s.complete();
  await flush();
  expect(refresh).toHaveBeenCalledTimes(1);
  s.begin();
  s.complete();
  s.begin();
  s.complete();
  jest.advanceTimersByTime(1999);
  await flush();
  expect(refresh).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(1);
  await flush();
  expect(refresh).toHaveBeenCalledTimes(2);
  s.begin();
  s.complete();
  jest.advanceTimersByTime(1999);
  s.begin();
  jest.advanceTimersByTime(5000);
  await flush();
  expect(refresh).toHaveBeenCalledTimes(2);
  s.complete();
  await flush();
  expect(refresh).toHaveBeenCalledTimes(3);
  expect(fail).not.toHaveBeenCalled();
  s.dispose();
});
test('slow requests never overlap, runtime policy changes retain the last start and failures remain retryable', async () => {
  let finish: () => void = () => {};
  const refresh = jest.fn(
      () =>
        new Promise<void>((r) => {
          finish = r;
        }),
    ),
    fail = jest.fn();
  const s = createGestureRefresh({ intervalMs: 2000, refresh, onError: fail });
  s.complete();
  await flush();
  s.complete();
  jest.advanceTimersByTime(4000);
  await flush();
  expect(refresh).toHaveBeenCalledTimes(1);
  finish();
  await flush();
  expect(refresh).toHaveBeenCalledTimes(2);
  s.complete();
  s.updateInterval(6000);
  finish();
  await flush();
  jest.advanceTimersByTime(5999);
  await flush();
  expect(refresh).toHaveBeenCalledTimes(2);
  refresh.mockRejectedValueOnce(new Error('offline'));
  jest.advanceTimersByTime(1);
  await flush();
  expect(refresh).toHaveBeenCalledTimes(3);
  expect(fail).toHaveBeenCalledTimes(1);
  s.dispose();
});
test('background cancellation/unmount prevents queued or deferred callbacks and reports no error after disposal', async () => {
  const refresh = jest.fn(async () => {}),
    fail = jest.fn();
  const s = createGestureRefresh({ intervalMs: 2000, refresh, onError: fail });
  s.complete();
  s.cancel();
  await flush();
  expect(refresh).not.toHaveBeenCalled();
  s.complete();
  await flush();
  expect(refresh).toHaveBeenCalledTimes(1);
  s.complete();
  s.dispose();
  jest.advanceTimersByTime(10000);
  await flush();
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(fail).not.toHaveBeenCalled();
});
