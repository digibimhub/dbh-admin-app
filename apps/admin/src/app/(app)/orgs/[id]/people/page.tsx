'use client';

import { useState } from 'react';
import { useCan } from '@/lib/session';
import { useOrg } from '@/components/OrgContext';
import { AddUserDialog } from '@/components/AddUserDialog';
import { UserCsvImport } from '@/components/UserCsvImport';
import { MembersTable } from '@/components/MembersTable';
import { Button, MoreMenu } from '@/components/ui';

export default function OrgPeoplePage() {
  const { detail, reload: reloadOrg } = useOrg();
  const orgId = detail.org.id;

  const canAdd = useCan('user.manage');
  const canImport = useCan('user.import');

  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [tick, setTick] = useState(0);

  function changed() {
    setTick((t) => t + 1);
    reloadOrg();
  }

  return (
    <div>
      <MembersTable
        orgId={orgId}
        seats={detail.seats}
        licenceActive={Boolean(detail.license && detail.license.status === 'active')}
        reloadKey={tick}
        onChanged={reloadOrg}
        toolbar={(
          <>
            {canAdd && <Button variant="primary" onClick={() => setAdding(true)}>Add person…</Button>}
            {canImport && <MoreMenu items={[{ label: 'Import CSV…', onSelect: () => setImporting(true) }]} />}
          </>
        )}
        emptyAction={canAdd ? <Button variant="primary" onClick={() => setAdding(true)}>Add person…</Button> : undefined}
      />

      <AddUserDialog
        open={adding}
        orgId={orgId}
        onClose={() => setAdding(false)}
        onAdded={changed}
      />
      <UserCsvImport
        open={importing}
        orgId={orgId}
        onClose={() => setImporting(false)}
        onImported={changed}
      />
    </div>
  );
}
