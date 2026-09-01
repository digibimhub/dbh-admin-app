'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';

/**
 * Filters live in the URL so a view can be pasted into a ticket and land on the
 * same rows. Changing any filter resets to page 1 — the only way to get to a
 * page number is to ask for it explicitly.
 */
export function useUrlState<K extends string>(defaults: Record<K, string>) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  const values = useMemo(() => {
    const out = { ...defaults } as Record<K, string>;
    for (const key of Object.keys(defaults) as K[]) {
      const v = search.get(key);
      if (v !== null) out[key] = v;
    }
    return out;
  }, [search, defaults]);

  const set = useCallback((patch: Partial<Record<K | 'page', string | number>>) => {
    const next = new URLSearchParams(search.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === '' || v === null) next.delete(k);
      else next.set(k, String(v));
    }
    if (!('page' in patch)) next.delete('page');
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [router, pathname, search]);

  const reset = useCallback(() => {
    router.replace(pathname, { scroll: false });
  }, [router, pathname]);

  const page = Math.max(1, Number(search.get('page') ?? '1') || 1);
  const active = (Object.keys(defaults) as K[]).filter((k) => values[k] !== defaults[k]).length;

  return { values, set, reset, page, activeFilterCount: active };
}
