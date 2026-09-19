'use client';

import { useOrg } from '@/components/OrgContext';
import { AuditTable } from '@/components/AuditTable';
import { PageHeader } from '@/components/ui';

export default function OrgScopeActivityPage() {
  const { detail } = useOrg();
  return (
    <div>
      <PageHeader title="Activity" lede="Every change to your organisation, with its before and after state." />
      <AuditTable orgId={detail.org.id} />
    </div>
  );
}
