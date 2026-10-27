export async function registerNode() {
  // Build workers have no credentials and do not start background processing.
  if (process.env.QADAM_BACKEND !== 'true') return;
  const { validateBackend } = await import('./config');
  const { database, closeDatabase } = await import('../src/lib/db');
  validateBackend();
  await database().query('SELECT 1');
  if (process.env.TELEGRAM_AUTH_ENABLED !== 'true' || process.env.TELEGRAM_WORKER_ENABLED === 'false') return;
  const state = globalThis as typeof globalThis & { qadamWorkerStop?: () => Promise<void> };
  if (state.qadamWorkerStop) return;
  const { startWorker } = await import('./worker');
  const { processTelegramJobs } = await import('../src/lib/telegram-bot');
  const stop = startWorker(processTelegramJobs);
  state.qadamWorkerStop = stop;
  const shutdown = () => { void stop().then(closeDatabase).catch(() => console.error('Database shutdown failed')); };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
