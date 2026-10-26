import type { Metadata } from 'next';
import localFont from 'next/font/local';
import Script from 'next/script';
import './globals.css';

const onest = localFont({ src: '../../public/fonts/Onest-Variable.ttf', variable: '--font-onest', weight: '100 900', display: 'swap' });

export const metadata: Metadata = {
  title: 'Qadam Delivery — доставка шаг за шагом',
  description: 'Qadam Delivery — заказывайте доставку и принимайте заказы в Telegram. Алматы.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // The official SDK sets viewport CSS variables on <html> before hydration.
  return <html lang="ru" className={onest.variable} suppressHydrationWarning><body><Script src="https://telegram.org/js/telegram-web-app.js?64" strategy="beforeInteractive"/>{children}</body></html>;
}
