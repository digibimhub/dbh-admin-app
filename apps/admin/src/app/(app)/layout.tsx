import type { ReactNode } from 'react';
import { AppShell } from '@/components/AppShell';
import { SessionProvider } from '@/lib/session';

/**
 * Everything behind the session cookie renders on demand. The screens read
 * filters out of the URL with `useSearchParams`, and prerendering them would
 * either bail out of static generation or freeze an empty query string into the
 * HTML — neither is useful for an admin panel that is never public.
 */
export const dynamic = 'force-dynamic';

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <AppShell>{children}</AppShell>
    </SessionProvider>
  );
}
