'use client';

import { useEffect, useMemo, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import type { MemberStatus, RoleRow, SeatUsage } from '@/lib/types';
import { Modal } from './Modal';
import { Button, ErrorNote, Field, Select, TimeAgo } from './ui';

/** The slice of a member the dialog needs. Both `UserRow.user` and `OrgRequestRow.user` satisfy it. */
export type ApproveTarget = {
  id: string;
  displayName: string | null;
  email: string | null;
  roleKey: string;
  status: MemberStatus;
  firstSeenAt: string;
  attemptCount?: number;
};

/** Free seats in a role, from either shape the API uses for seat usage. */
export function freeSeats(seats: SeatUsage[], roleKey: string): number | null {
  const s = seats.find((x) => x.roleKey === roleKey);
  return s ? s.seats - s.used : null;
}

/**
 * Approve a waiting (or rejected) member into a role.
 *
 * The role select says how many seats each role has free, and a full role is
 * disabled before anybody tries it. A 409 from the API — the seat went in the
 * meantime, or there is no licence — shows inline and the dialog stays open,
 * so the choice can be changed rather than retyped.
 */
export function ApproveDialog({ open, target, roles, seats, licenceActive = true, onClose, onApproved }: {
  open: boolean;
  target: ApproveTarget | null;
  /** Fetched from `/admin/roles` when not supplied. */
  roles?: RoleRow[];
  seats: SeatUsage[];
  licenceActive?: boolean;
  onClose: () => void;
  onApproved: () => void;
}) {
  const [fetched, setFetched] = useState<RoleRow[]>([]);
  const [roleKey, setRoleKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const available = useMemo(
    () => (roles ?? fetched).filter((r) => r.isActive),
    [roles, fetched],
  );

  useEffect(() => {
    if (!open || roles) return;
    api<{ rows: RoleRow[] }>('/admin/roles').then((d) => setFetched(d.rows)).catch(() => undefined);
  }, [open, roles]);

  // Reset on open, not on success: cancelling must not leave a stale choice
  // or a stale error for the next person.
  useEffect(() => {
    if (!open || !target) return;
    setError(null);
    setBusy(false);
    const free = (k: string) => (freeSeats(seats, k) ?? 0) > 0;
    const current = target.roleKey;
    const fallback = available.find((r) => r.isDefault && free(r.key)) ?? available.find((r) => free(r.key));
    setRoleKey(free(current) ? current : (fallback?.key ?? current));
  }, [open, target, seats, available]);

  if (!target) return null;

  const chosenFree = freeSeats(seats, roleKey);
  const full = chosenFree !== null && chosenFree <= 0;
  const chosenName = available.find((r) => r.key === roleKey)?.name ?? roleKey;
  const name = target.displayName?.trim() || target.email || 'this person';
  const reopen = target.status === 'rejected';

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api(`/admin/users/${target!.id}/approve`, {
        method: 'POST',
        body: JSON.stringify({ roleKey: roleKey || undefined }),
      });
      onApproved();
    } catch (e: unknown) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  const hint = !licenceActive
    ? 'No licence yet. Nobody can be approved until one is issued.'
    : full
      ? `${chosenName} has no free seat. Choose another role, or ask for more seats.`
      : 'They take a seat in this role now and are working at their next check.';

  return (
    <Modal
      open={open}
      title={`Approve ${name}`}
      onClose={onClose}
      footer={(
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={busy || full || !licenceActive || !roleKey}>
            {busy ? 'Approving…' : 'Approve'}
          </Button>
        </>
      )}
    >
      {error && <ErrorNote>{error}</ErrorNote>}

      <p className="text-meta text-ink-3 mb-4">
        {target.email ?? 'no email on record'}
        {' · '}{reopen ? 'rejected' : 'requested'} <TimeAgo value={target.firstSeenAt} />
        {target.attemptCount !== undefined && (
          <> · {target.attemptCount} attempt{target.attemptCount === 1 ? '' : 's'}</>
        )}
      </p>

      <Field label="Role" hint={hint}>
        <Select value={roleKey} onChange={(e) => setRoleKey(e.target.value)} disabled={busy}>
          {available.map((r) => {
            const free = freeSeats(seats, r.key);
            const label = free === null ? '' : free > 0 ? ` — ${free} free` : ' — full';
            return (
              <option key={r.key} value={r.key} disabled={free !== null && free <= 0}>
                {r.name}{r.isDefault ? ' (default)' : ''}{label}
              </option>
            );
          })}
          {!available.length && <option value={target.roleKey}>{target.roleKey}</option>}
        </Select>
      </Field>

      {reopen && (
        <p className="text-meta text-ink-3 mt-4">
          Approving a rejected request lets them in after all. The rejection note stays in the audit log.
        </p>
      )}
    </Modal>
  );
}
