'use client';

import { useOrg } from '@/components/OrgContext';
import { OrgRequestsTable } from '@/components/OrgRequestsTable';

/** The organisation's own queue, shared with the organisation admin's Requests page. */
export default function OrgRequestsPage() {
  const { detail, reload } = useOrg();
  return (
    <OrgRequestsTable
      orgId={detail.org.id}
      domains={detail.domains.map((d) => d.value)}
      joinPolicy={detail.org.joinPolicy}
      onChanged={reload}
    />
  );
}
