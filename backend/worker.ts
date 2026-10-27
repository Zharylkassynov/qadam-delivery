// One batch at a time. Failure schedules another attempt; queued jobs remain in SQL.
export function startWorker(run: () => Promise<void>, intervalMs = 1000, onError = () => console.error('Telegram worker unavailable')) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active: Promise<void> = Promise.resolve();
  const tick = () => {
    if (stopped) return;
    active = Promise.resolve().then(run).catch(() => onError()).then(() => {
      if (!stopped) { timer = setTimeout(tick, intervalMs); timer.unref(); }
    });
  };
  tick();
  return async () => { stopped = true; clearTimeout(timer); await active; };
}
