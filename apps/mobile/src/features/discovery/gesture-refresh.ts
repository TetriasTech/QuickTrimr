// UI request scheduling only; never enforces availability, expiry or booking state.
export function createGestureRefresh({
  intervalMs: initialInterval,
  refresh,
  onError,
  now = () => performance.now(),
}: {
  intervalMs: number;
  refresh: () => Promise<unknown>;
  onError: () => void;
  now?: () => number;
}) {
  function validate(value: number) {
    if (!Number.isSafeInteger(value) || value <= 0 || value > 2_147_483_647)
      throw new Error('Invalid map refresh policy');
  }
  validate(initialInterval);
  let intervalMs = initialInterval;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastStart = -Infinity,
    moving = false,
    pending = false,
    running = false,
    disposed = false,
    epoch = 0;
  function clear() {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  }
  function schedule() {
    clear();
    if (disposed || moving || running || !pending) return;
    const wait = Math.max(0, intervalMs - (now() - lastStart));
    if (wait > 0) {
      timer = setTimeout(schedule, wait);
      return;
    }
    pending = false;
    running = true;
    const scheduledEpoch = epoch;
    Promise.resolve()
      .then(() => {
        if (disposed || scheduledEpoch !== epoch) return;
        lastStart = now();
        return refresh();
      })
      .catch(() => {
        if (!disposed) onError();
      })
      .finally(() => {
        running = false;
        schedule();
      });
  }
  return {
    begin() {
      if (disposed) return;
      epoch++;
      moving = true;
      pending = false;
      clear();
    },
    complete() {
      if (disposed) return;
      moving = false;
      pending = true;
      schedule();
    },
    updateInterval(value: number) {
      validate(value);
      intervalMs = value;
      schedule();
    },
    cancel() {
      epoch++;
      moving = false;
      pending = false;
      clear();
    },
    dispose() {
      epoch++;
      disposed = true;
      pending = false;
      clear();
    },
  };
}
