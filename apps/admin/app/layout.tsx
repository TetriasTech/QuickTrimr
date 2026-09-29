import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { QUICKTRIMR_PRODUCT } from '@quicktrimr/shared';
import './globals.css';

export const metadata: Metadata = {
  title: `${QUICKTRIMR_PRODUCT} Admin`,
  description: 'QuickTrimr administration foundation.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-AU">
      <body>{children}</body>
    </html>
  );
}
