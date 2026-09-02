'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { useCan, useSession } from '@/lib/session';
import { ROLE_LABEL } from '@/lib/permissions';

/**
 * There is no max-width any more.
 *
 * The cap used to be 1280px on every screen, including the ones whose whole
 * job is a wide table — on a 1920px display that threw away a third of the
 * window and pushed columns into a horizontal scroll that had room to spare.
 * Content now takes the window and keeps a gutter.
 */
export const SHELL = 'w-full';

const NAV = [
  { href: '/', label: 'Dashboard' },
  { href: '/orgs', label: 'Organisations' },
  { href: '/users', label: 'Users' },
  { href: '/devices', label: 'Devices' },
  { href: '/requests', label: 'Requests' },
  { href: '/licenses', label: 'Licences' },
  { href: '/settings', label: 'Settings' },
];

function initials(email: string, name?: string | null): string {
  if (name?.trim()) {
    const parts = name.trim().split(/\s+/);
    return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

/**
 * How many people are waiting on somebody's decision.
 *
 * `Tabs` has always taken a `badge` and nothing ever passed one, so the queue
 * was invisible unless you went looking. Counted once per mount and left alone:
 * a poll would spend the /admin rate-limit budget on every open tab to move a
 * number nobody is watching in real time.
 */
function usePendingRequests(): number {
  const canReview = useCan('request.review');
  const [n, setN] = useState(0);

  useEffect(() => {
    if (!canReview) return;
    let live = true;
    api<{ total: number }>('/admin/access-requests?status=pending&pageSize=1')
      .then((d) => { if (live) setN(d.total ?? 0); })
      .catch(() => undefined);
    return () => { live = false; };
  }, [canReview]);

  return n;
}

/**
 * Two bands, not three.
 *
 * The rail cost 200px of every screen and still sat above a page header and a
 * SubNav, so a table's first row started ~280px down. Identity and account go
 * on one line, destinations on the next, and everything below that is content.
 * The tab strip is the same component the org and settings sections use, so
 * there is one nav idiom in the product rather than two.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const pendingRequests = usePendingRequests();

  async function logout() {
    await api('/admin/auth/logout', { method: 'POST' }).catch(() => undefined);
    window.location.href = '/login';
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-30 bg-card border-b border-rule">
        <div className="flex items-center gap-4 px-5 h-[52px]">
          <Link href="/" className="font-semibold text-title tracking-tight whitespace-nowrap">
            DIGIBIM <span className="font-medium text-ink-3">Licensing</span>
          </Link>

          <div className="ml-auto flex items-center gap-3 min-w-0">
            {user && (
              <div className="min-w-0 text-right hidden sm:block">
                <p className="text-meta font-medium truncate">{user.email}</p>
                <p className="text-micro text-ink-3 leading-none">{ROLE_LABEL[user.role]}</p>
              </div>
            )}
            {user && (
              <span
                aria-hidden
                className="w-[26px] h-[26px] rounded-full bg-signal-soft text-signal grid place-items-center text-micro font-semibold shrink-0"
              >
                {initials(user.email, user.displayName)}
              </span>
            )}
            <button
              onClick={logout}
              className="text-micro uppercase tracking-wider text-ink-3 hover:text-ink whitespace-nowrap"
            >
              Sign out
            </button>
          </div>
        </div>

        <Tabs
          items={NAV.map((item) => (item.href === '/requests' && pendingRequests > 0
            ? { ...item, badge: pendingRequests }
            : item))}
          ariaLabel="Primary"
          flush
        />
      </header>

      <main className="flex-1 px-5 py-6 pb-20">{children}</main>
    </div>
  );
}

/**
 * One tab strip, used by the primary nav and by every section that has tabs.
 *
 * `flush` drops the bottom rule and the margin, for the case where the strip
 * is the last band of a header that already carries one.
 */
export function Tabs({ items, ariaLabel = 'Section', flush = false }: {
  items: { href: string; label: string; badge?: number }[];
  ariaLabel?: string;
  flush?: boolean;
}) {
  const path = usePathname();
  const strip = (
    <nav
      aria-label={ariaLabel}
      // The link's own px-3 is the offset to cancel. `flush` sits outside any
      // gutter and needs px-2 (8 + 12 = 20, the shell's px-5); the section
      // strip sits inside that gutter already and needs -mx-3 to pull its
      // first label back onto it.
      className={`flex gap-0.5 overflow-x-auto ${flush ? 'px-2' : '-mx-3'}`}
    >
      {items.map((item) => {
        /*
          A tab whose href is a prefix of a sibling's must match exactly.
          The org strip is `/orgs/:id` plus `/orgs/:id/{domains,license,people}`,
          so prefix matching lit Overview on every one of them — two tabs
          underlined at once. The primary nav has no such pair, and still wants
          the prefix rule so Organisations stays lit on an org's detail page.
        */
        const exact = items.some((o) => o.href !== item.href && o.href.startsWith(`${item.href}/`));
        const on = item.href === '/' || exact
          ? path === item.href
          : path === item.href || path.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={on ? 'page' : undefined}
            className={`font-semibold text-body px-3 py-2 whitespace-nowrap border-b-2 transition-colors flex items-center gap-1.5 ${
              on ? 'text-ink border-signal' : 'text-ink-3 border-transparent hover:text-ink'
            }`}
          >
            {item.label}
            {item.badge !== undefined && item.badge > 0 && (
              <span className="tabular-nums text-micro bg-warn-soft text-warn rounded-sm px-1.5 py-0.5">
                {item.badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
  // The rule and the margin go on a wrapper, so they keep the content width
  // while the scroller overhangs it.
  if (flush) return strip;
  return <div className="border-b border-rule mb-5">{strip}</div>;
}

/** Kept as an alias so existing sections keep working while they migrate. */
export const SubNav = Tabs;
