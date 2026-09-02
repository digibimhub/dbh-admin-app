'use client';

import { AuditTable } from '@/components/AuditTable';
import { Section } from '@/components/ui';

export default function AuditPage() {
  return (
    <Section
      title="Audit log"
      note="Every change made through the API, with its before and after state."
    >
      <AuditTable />
    </Section>
  );
}
