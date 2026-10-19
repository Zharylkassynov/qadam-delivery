'use client';

type TelegramWebApp = { initData: string; ready(): void; expand(): void };
declare global { interface Window { Telegram?: { WebApp?: TelegramWebApp } } }

export async function telegramApp() {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const expected = params.has('tgWebAppData') || params.has('tgWebAppVersion');
  // beforeInteractive scripts can still be loading during hydration.
  if (expected && !window.Telegram?.WebApp) {
    await new Promise<void>((resolve) => {
      const started = Date.now();
      const timer = setInterval(() => {
        if (window.Telegram?.WebApp || Date.now() - started > 6000) { clearInterval(timer); resolve(); }
      }, 50);
    });
  }
  const app = window.Telegram?.WebApp;
  if (app?.initData) { document.documentElement.dataset.telegram = 'true'; app.ready(); app.expand(); return app; }
  if (expected) throw new Error('Не удалось подключиться к Telegram. Закройте Mini App и откройте его заново через бота.');
  return null;
}
