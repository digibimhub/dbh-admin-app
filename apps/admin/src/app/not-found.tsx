import Link from 'next/link';
import { PublicShell } from '@/components/PublicShell';

/**
 * `/` is the scope-aware overview: it is the dashboard for a portal admin and
 * redirects an organisation admin to `/org`, so one link serves both.
 */
export default function NotFound() {
  return (
    <PublicShell>
      <h1 className="text-page font-bold text-ink mb-2">That page does not exist</h1>
      <p className="text-body text-ink-2 mb-6">
        The address may be out of date, or the record it pointed at has gone.
      </p>
      <Link
        href="/"
        className="inline-flex items-center justify-center h-10 px-5 rounded-sm bg-ink text-card text-control font-bold hover:bg-nav-active"
      >
        Go to overview
      </Link>
    </PublicShell>
  );
}
