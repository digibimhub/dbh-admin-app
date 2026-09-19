'use client';

import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '@/lib/api';
import { useCan } from '@/lib/session';
import { useOrg } from '@/components/OrgContext';
import { DangerDialog } from '@/components/DangerDialog';
import type { OrgDomain } from '@/lib/types';
import {
  Button, EmptyState, ErrorNote, Note, Section, TextInput, TimeAgo,
} from '@/components/ui';

export default function OrgDomainsPage() {
  const { detail, reload } = useOrg();
  const org = detail.org;
  const canManage = useCan('domain.manage');

  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<OrgDomain | null>(null);

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/admin/orgs/${org.id}/domains`, {
        method: 'POST',
        body: JSON.stringify({ value: value.trim().toLowerCase() }),
      });
      setValue('');
      reload();
    } catch (err: unknown) {
      // The API's 409 already names the organisation that holds it.
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {error && <ErrorNote>{error}</ErrorNote>}

      <Section
        title="Registered domains"
        note="A verified Autodesk email on one of these resolves here. Each domain belongs to one organisation."
      >
        {detail.domains.length ? (
          <div className="overflow-x-auto -mx-6">
            <table className="w-full text-control text-ink">
              <thead>
                <tr className="text-left border-y border-ink/10">
                  <th className="font-bold px-6 py-4">Domain</th>
                  <th className="font-bold px-4 py-4">Added</th>
                  <th className="px-6 py-4" />
                </tr>
              </thead>
              <tbody>
                {detail.domains.map((d) => (
                  <tr key={d.id} className="border-b border-rule last:border-0">
                    <td className="px-6 py-4 font-mono text-small">{d.value}</td>
                    <td className="px-4 py-4 text-ink-3"><TimeAgo value={d.createdAt} /></td>
                    <td className="px-6 py-4 text-right">
                      {canManage && <Button variant="ghost" size="sm" onClick={() => setRemoving(d)}>Remove…</Button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No domains registered">
            Until a domain is registered here, nobody can sign in to this organisation from the
            add-in. Every attempt lands in the access request queue as{' '}
            <code className="font-mono text-small">domain_not_registered</code>.
          </EmptyState>
        )}

        <Note>Public mailbox domains (gmail.com and the like) are refused. Anyone can hold an address on one.</Note>
      </Section>

      {canManage && (
        <Section title="Add a domain">
          <form onSubmit={add} className="flex flex-wrap items-start gap-3">
            <div className="flex-1 min-w-[240px] max-w-[360px]">
              <TextInput
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="acme-eng.com"
                className="font-mono"
                aria-label="Domain"
                required
              />
              <p className="text-meta text-ink-3 mt-1">
                The bare domain, with no <code className="font-mono">@</code> and no protocol.
              </p>
            </div>
            <Button variant="primary" type="submit" disabled={busy || value.trim().length < 4}>
              {busy ? 'Adding…' : 'Add domain'}
            </Button>
          </form>
        </Section>
      )}

      <DangerDialog
        open={removing !== null}
        title="Remove domain"
        verb="remove"
        targetKind="domain"
        target={removing?.value ?? ''}
        consequence="Nobody new can be provisioned from this domain afterwards. People who are already members keep working — removing a domain does not remove anybody."
        confirmLabel="Remove domain"
        onCancel={() => setRemoving(null)}
        onConfirm={async (reason) => {
          await api(`/admin/domains/${removing!.id}`, {
            method: 'DELETE',
            body: JSON.stringify({ reason }),
          });
          setRemoving(null);
          reload();
        }}
      />
    </div>
  );
}
