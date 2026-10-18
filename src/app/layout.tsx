import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';

const onest = localFont({ src: '../../public/fonts/Onest-Variable.ttf', variable: '--font-onest', weight: '100 900', display: 'swap' });

export const metadata: Metadata = {
  title: 'Qadam Delivery — доставка шаг за шагом',
  description: 'Учебное приложение для создания и выполнения заказов доставки.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru" className={onest.variable}><body>{children}</body></html>;
}
