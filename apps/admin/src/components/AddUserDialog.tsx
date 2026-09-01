'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage } from '@/lib/api';
import type { Organization, Paged, RoleRow } from '@/lib/types';
import { EMAIL_RE } from '@/lib/csv';
import { Modal } from './Modal';
import { Button, ErrorNote, Field, Note, Select, TextInput } from './ui';

export function AddUserDialog({ open, orgId, roles, onClose, onAdded }: {
  open: boolean;
  /** Fixed organisation when opened from an org screen. */
  orgId?: string;
  /** Supplied by the caller when it already has them; fetched otherwise. */
  roles?: RoleRow[];
  onClose: () => void;
  onAdded: () => void;
}) {
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [fetched, setFetched] = useState<RoleRow[]>([]);
  const [org, setOrg] = useState(orgId ?? '');
  const [email, setEmail] = useState('');
  const [autodeskId, setAutodeskId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [roleKey, setRoleKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const available = (roles ?? fetched).filter((r) => r.isActive);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (!orgId) {
      api<Paged<Organization>>('/admin/orgs?pageSize=100').then((d) => setOrgs(d.rows)).catch(() => undefined);
    }
    if (!roles) {
      api<{ rows: RoleRow[] }>('/admin/roles').then((d) => setFetched(d.rows)).catch(() => undefined);
    }
  }, [open, orgId, roles]);

  // Default to the role auto-provisioning would give them, so adding somebody
  // by hand and letting them sign in produce the same result.
  useEffect(() => {
    if (!roleKey && available.length) {
      setRoleKey((available.find((r) => r.isDefault) ?? available[0]!).key);
    }
  }, [available, roleKey]);

  const emailOk = EMAIL_RE.test(email.trim());
  const targetOrg = orgId ?? org;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!emailOk || !targetOrg) return;
    setBusy(true);
    setError(null);
    try {
      await api('/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          orgId: targetOrg,
          email: email.trim().toLowerCase(),
          autodeskId: autodeskId.trim() || undefined,
          displayName: displayName.trim() || undefined,
          roleKey: roleKey || undefined,
        }),
      });
      setEmail(''); setAutodeskId(''); setDisplayName('');
      onAdded();
      onClose();
    } catch (err: unknown) {
      // The 409 from a full role names the count, which is the thing the
      // operator has to act on.
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title="Add somebody manually" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {error && <ErrorNote>{error}</ErrorNote>}

        {!orgId && (
          <Field label="Organisation">
            <Select value={org} onChange={(e) => setOrg(e.target.value)} required>
              <option value="">Choose…</option>
              {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </Select>
          </Field>
        )}

        <Field label="Email" hint="Must match the address on their Autodesk account — that is what the OAuth exchange returns.">
          <TextInput
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </Field>

        <Field label="Display name" hint="Optional. Overwritten by Autodesk on first sign-in.">
          <TextInput value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </Field>

        <Field label="Autodesk ID" hint="Optional. Globally unique — one person belongs to exactly one organisation.">
          <TextInput value={autodeskId} onChange={(e) => setAutodeskId(e.target.value)} className="font-mono" />
        </Field>

        <Field label="Role" hint="They take a seat in this role immediately, so a full role will refuse.">
          <Select value={roleKey} onChange={(e) => setRoleKey(e.target.value)} required>
            {available.map((r) => (
              <option key={r.key} value={r.key}>
                {r.name}{r.isDefault ? ' (default)' : ''}
              </option>
            ))}
          </Select>
        </Field>

        <Note>
          Adding somebody before their first sign-in is fine: their Autodesk id is filled in when
          they arrive, and the row is matched by email until then.
        </Note>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={busy || !emailOk || !targetOrg || !roleKey}>
            {busy ? 'Adding…' : 'Add person'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
