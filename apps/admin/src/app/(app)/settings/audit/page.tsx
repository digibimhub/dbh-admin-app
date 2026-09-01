'use client';

import { AuditTable } from '@/components/AuditTable';
import { Section } from '@/components/ui';

export default function AuditPage() {
  return (
    <Section
      title="Audit log"
      note="Every mutation through the API writes an entry here with its before and after state, via middleware — there is no path that changes data without one."
    >
      <AuditTable />
    </Section>
  );
}
