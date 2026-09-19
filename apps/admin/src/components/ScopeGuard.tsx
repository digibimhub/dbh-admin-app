'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useScope, useSession } from '@/lib/session';

/**
 * Where an organisation admin may go: their own section, their account, and
 * the two record pages the API already scopes by row (a member, a device).
 * Anything else bounces to the overview with the path in `?denied=`, where a
 * banner explains. This is a courtesy, not the boundary — the API answers
 * 403 or 404 regardless.
 */
const ORG_ALLOWED = [/^\/org(\/|$)/, /^\/profile$/, /^\/users\/[^/]+$/, /^\/devices\/[^/]+$/];

export function ScopeGuard({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const scope = useScope();
  const path = usePathname();
  const router = useRouter();

  const mustChange = Boolean(user?.mustChangePassword);
  const orgDenied = scope.kind === 'org' && !ORG_ALLOWED.some((re) => re.test(path));
  const orgHome = scope.kind === 'org' && path === '/';

  useEffect(() => {
    if (mustChange) { window.location.href = '/login/password'; return; }
    if (orgHome) { router.replace('/org'); return; }
    if (orgDenied) router.replace(`/org?denied=${encodeURIComponent(path)}`);
  }, [mustChange, orgHome, orgDenied, path, router]);

  if (mustChange || orgHome || orgDenied) return null;
  return <>{children}</>;
}
