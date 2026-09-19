'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, errorMessage } from '@/lib/api';
import { useScope } from '@/lib/session';
import type { OrgDetail } from '@/lib/types';
import { OrgProvider } from '@/components/OrgContext';
import { EmptyState, ErrorNote, Loading } from '@/components/ui';

/**
 * The organisation admin's section. Their one organisation is fetched here
 * into the same `OrgProvider` the portal admin's record pages use, so the
 * shared tables read it the same way.
 */
export default function OrgScopeLayout({ children }: { children: ReactNode }) {
  const scope = useScope();
  const orgId = scope.kind === 'org' ? scope.orgId : null;
  const [detail, setDetail] = useState<OrgDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    if (!orgId) return;
    api<OrgDetail>(`/admin/orgs/${orgId}`)
      .then((d) => { setDetail(d); setError(null); })
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [orgId]);

  useEffect(() => { reload(); }, [reload]);

  if (!orgId) {
    return (
      <EmptyState title="This section is for organisation admins">
        A portal admin sees every organisation under Organisations.
      </EmptyState>
    );
  }
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!detail) return <Loading what="Loading your organisation" />;

  return <OrgProvider value={{ detail, reload }}>{children}</OrgProvider>;
}
