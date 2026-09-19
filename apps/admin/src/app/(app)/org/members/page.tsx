'use client';

import { useOrg } from '@/components/OrgContext';
import { MembersTable } from '@/components/MembersTable';
import { PageHeader } from '@/components/ui';

/**
 * Members arrive through Autodesk sign-in; an organisation admin cannot add
 * or import them, so there is no toolbar.
 */
export default function OrgMembersPage() {
  const { detail, reload } = useOrg();
  return (
    <div>
      <PageHeader title="Members" />
      <MembersTable
        orgId={detail.org.id}
        seats={detail.seats}
        licenceActive={Boolean(detail.license && detail.license.status === 'active')}
        onChanged={reload}
      />
    </div>
  );
}
