'use client';

import { useState } from 'react';
import { useCan } from '@/lib/session';
import { UsersTable } from '@/components/UsersTable';
import { AddUserDialog } from '@/components/AddUserDialog';
import { UserCsvImport } from '@/components/UserCsvImport';
import { Button, PageHeader } from '@/components/ui';

export default function UsersPage() {
  const canManage = useCan('user.manage');
  const canImport = useCan('user.import');
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  return (
    <div>
      <PageHeader
        eyebrow="People"
        title="Users"
        lede="Everyone the platform knows about, across every organisation. Source is worth watching — when a customer disputes their user count, “312 auto-provisioned, 8 imported, 3 approved” ends the conversation."
        actions={
          <>
            {canImport && <Button onClick={() => setImporting(true)}>Import CSV</Button>}
            {canManage && <Button variant="primary" onClick={() => setAdding(true)}>Add user</Button>}
          </>
        }
      />

      <UsersTable reloadKey={reloadKey} />

      <AddUserDialog open={adding} onClose={() => setAdding(false)} onAdded={() => setReloadKey((k) => k + 1)} />
      <UserCsvImport open={importing} onClose={() => setImporting(false)} onImported={() => setReloadKey((k) => k + 1)} />
    </div>
  );
}
