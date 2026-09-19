'use client';

import { useOrg } from '@/components/OrgContext';
import { DevicesTable } from '@/components/DevicesTable';
import { PageHeader } from '@/components/ui';

export default function OrgScopeDevicesPage() {
  const { detail } = useOrg();
  return (
    <div>
      <PageHeader title="Devices" lede="Every machine your members have validated from." />
      <DevicesTable orgId={detail.org.id} />
    </div>
  );
}
