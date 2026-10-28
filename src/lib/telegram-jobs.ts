import { waitUntil } from '@vercel/functions';
import { processTelegramJobs } from './telegram-bot';

export function scheduleTelegramJobs() {
  // The standalone API has a persistent worker, including recovery after restart.
  if (process.env.QADAM_BACKEND === 'true' || process.env.TELEGRAM_WORKER_ENABLED === 'false') return;
  const work = processTelegramJobs().catch(() => console.error('Telegram worker unavailable'));
  if (process.env.VERCEL === '1') waitUntil(work);
  else void work;
}
