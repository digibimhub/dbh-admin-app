'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { errorMessage, isStepUpRequired, stepUp } from '@/lib/api';
import { Button, ErrorNote, Field, TextArea } from './ui';
import { Modal } from './Modal';
import { TotpInput } from './TotpInput';

/**
 * Every destructive action goes through here. The spec asks for four things and
 * this component is the only place they are guaranteed together:
 *   1. a confirmation dialog that names the thing being changed
 *   2. a mandatory reason
 *   3. step-up TOTP
 *   4. an audit entry (written by the API's audit middleware on the mutation)
 */
export function DangerDialog({
  open, title, target, targetKind, consequence, confirmLabel, requireStepUp = true,
  reasonLabel = 'Reason (recorded in the audit log)', onCancel, onConfirm,
}: {
  open: boolean;
  title: string;
  /** The exact name of the thing being changed — shown verbatim. */
  target: string;
  targetKind: string;
  consequence: ReactNode;
  confirmLabel: string;
  requireStepUp?: boolean;
  reasonLabel?: string;
  onCancel: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [totp, setTotp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsTotp, setNeedsTotp] = useState(requireStepUp);

  useEffect(() => {
    if (open) { setReason(''); setTotp(''); setError(null); setBusy(false); setNeedsTotp(requireStepUp); }
  }, [open, requireStepUp]);

  const reasonOk = reason.trim().length >= 3;
  const totpOk = !needsTotp || /^\d{6}$/.test(totp);

  async function submit() {
    if (!reasonOk || !totpOk) return;
    setBusy(true);
    setError(null);
    try {
      if (needsTotp) await stepUp(totp);
      await onConfirm(reason.trim());
    } catch (err) {
      if (isStepUpRequired(err)) {
        setNeedsTotp(true);
        setError('This action needs a fresh authenticator code. Enter one and try again.');
      } else {
        setError(errorMessage(err, 'The action failed. Nothing was changed.'));
      }
      setBusy(false);
      return;
    }
    setBusy(false);
  }

  return (
    <Modal open={open} title={title} onClose={onCancel}>
      <p className="text-body text-ink-2 mb-1">You are about to change this {targetKind}:</p>
      <p className="font-mono text-body bg-paper-2 border border-rule rounded-sm px-3 py-2 mb-3 break-words">
        {target}
      </p>
      <p className="text-body text-ink-2 mb-4">{consequence}</p>

      {error && <ErrorNote>{error}</ErrorNote>}

      <Field label={reasonLabel} className="mb-4">
        <TextArea
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why is this happening? At least 3 characters."
          autoFocus
        />
      </Field>

      {needsTotp && (
        <div className="mb-4">
          <p className="text-micro uppercase tracking-[0.1em] text-ink-3 mb-1">Authenticator code</p>
          <TotpInput value={totp} onChange={setTotp} />
          <p className="text-meta text-ink-3 mt-1">
            Step-up confirmation. Your password is not needed again.
          </p>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button variant="danger" onClick={submit} disabled={busy || !reasonOk || !totpOk}>
          {busy ? 'Working…' : confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
