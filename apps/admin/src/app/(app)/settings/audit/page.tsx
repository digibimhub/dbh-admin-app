'use client';

import { AuditTable } from '@/components/AuditTable';

export default function AuditPage() {
  return (
    <div>
      <h2 className="text-title font-bold text-ink mb-1">Audit log</h2>
      <p className="text-meta text-ink-3 mb-4">Every change made through the API, with its before and after state.</p>
      <AuditTable />
    </div>
  );
}
