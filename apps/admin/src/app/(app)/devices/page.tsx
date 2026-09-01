'use client';

import { DevicesTable } from '@/components/DevicesTable';
import { PageHeader } from '@/components/ui';

export default function DevicesPage() {
  return (
    <div>
      <PageHeader
        eyebrow="Estate"
        title="Devices"
        lede="Devices are created automatically on the first successful validation. This screen is for inspection and for disabling a machine — the only access decision a device carries."
      />
      <DevicesTable />
    </div>
  );
}
