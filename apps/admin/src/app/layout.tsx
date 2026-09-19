import type { ReactNode } from 'react';
import { Manrope } from 'next/font/google';
import './globals.css';

/**
 * Manrope: the closest Google face to Autodesk's Artifakt — geometric-humanist,
 * a real 800 for record titles, tabular figures. Self-hosted by `next/font`, so
 * there is no stylesheet request, no preconnect, and no flash of fallback text.
 *
 * Fallback if tables wrap at 1024: swap for Inter Tight here, one line.
 */
const manrope = Manrope({
  subsets: ['latin'],
  weight: ['400', '600', '700', '800'],
  variable: '--font-sans',
  display: 'swap',
});

export const metadata = {
  title: 'DIGIBIM HUB — Licensing',
  description: 'Revit add-in licensing admin',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={manrope.variable}>
      <body className="font-sans min-h-screen text-body">{children}</body>
    </html>
  );
}
