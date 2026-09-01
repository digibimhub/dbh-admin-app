import type { ReactNode } from 'react';
import { Inter } from 'next/font/google';
import './globals.css';

/**
 * Self-hosted by `next/font` — it ships inside `next`, so there is no
 * stylesheet request, no preconnect, and no flash of fallback text.
 */
const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-sans',
  display: 'swap',
});

export const metadata = {
  title: 'DIGIBIM HUB — Licensing',
  description: 'Revit add-in licensing admin',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="font-sans min-h-screen">{children}</body>
    </html>
  );
}
