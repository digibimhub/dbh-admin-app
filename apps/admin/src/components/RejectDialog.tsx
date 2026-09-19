'use client';

import { api } from '@/lib/api';
import { DangerDialog } from './DangerDialog';

export type RequestTarget = { id: string; email: string | null; displayName: string | null };

function nameOf(t: RequestTarget): string {
  return t.email ?? t.displayName ?? t.id;
}

/**
 * Reject is persisted: the person is told at their next sign-in and does not
 * silently reappear. No step-up — nothing is destroyed, and Approve undoes it.
 * With several targets the one reason is applied to each in turn.
 */
export function RejectDialog({ targets, onClose, onRejected }: {
  targets: RequestTarget[];
  onClose: () => void;
  /** Called once, with any failures, after every target has been tried. */
  onRejected: (failed: string[]) => void;
}) {
  const many = targets.length > 1;
  return (
    <DangerDialog
      open={targets.length > 0}
      title={many ? `Reject ${targets.length} requests` : 'Reject request'}
      verb="reject"
      targetKind={many ? 'set of requests' : 'request'}
      target={targets.map(nameOf).join(', ')}
      consequence="They stay blocked and see the same message next time they sign in. The note is kept on the request and shown on the Rejected tab."
      confirmLabel={many ? 'Reject requests' : 'Reject request'}
      reasonLabel="Reason"
      requireStepUp={false}
      onCancel={onClose}
      onConfirm={async (reason) => {
        const failed: string[] = [];
        for (const t of targets) {
          try {
            await api(`/admin/users/${t.id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) });
          } catch (e: unknown) {
            failed.push(`${nameOf(t)}: ${e instanceof Error ? e.message : 'failed'}`);
          }
        }
        if (failed.length === targets.length) throw new Error(failed.join('; '));
        onRejected(failed);
      }}
    />
  );
}

/**
 * Delete forgets the record, so their next sign-in starts a fresh request.
 * Only a row that never held a seat can go, and it needs step-up.
 */
export function DeleteRequestDialog({ target, onClose, onDeleted }: {
  target: RequestTarget | null;
  onClose: () => void;
  onDeleted: () => void;
}) {
  return (
    <DangerDialog
      open={target !== null}
      title="Delete request"
      verb="delete"
      targetKind="request"
      target={target ? nameOf(target) : ''}
      consequence="The record is removed. If they sign in again they start a new request. Only a request that never held a seat can be deleted."
      confirmLabel="Delete request"
      reasonLabel="Reason"
      onCancel={onClose}
      onConfirm={async (reason) => {
        await api(`/admin/users/${target!.id}`, { method: 'DELETE', body: JSON.stringify({ reason }) });
        onDeleted();
      }}
    />
  );
}
