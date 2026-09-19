'use client';

import { useOrg } from '@/components/OrgContext';
import { OrgRequestsTable } from '@/components/OrgRequestsTable';
import { PageHeader } from '@/components/ui';

export default function OrgScopeRequestsPage() {
  const { detail, reload } = useOrg();
  return (
    <div>
      <PageHeader title="Requests" />
      <OrgRequestsTable
        orgId={detail.org.id}
        domains={detail.domains.map((d) => d.value)}
        joinPolicy={detail.org.joinPolicy}
        onChanged={reload}
      />
    </div>
  );
}
