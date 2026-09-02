'use client';

import { DevicesTable } from '@/components/DevicesTable';
import { PageHeader } from '@/components/ui';

export default function DevicesPage() {
  return (
    <div>
      <PageHeader
        eyebrow="Estate"
        title="Devices"
        lede="Every machine that has validated. Disabling one is the only access decision a device carries."
      />
      <DevicesTable />
    </div>
  );
}
