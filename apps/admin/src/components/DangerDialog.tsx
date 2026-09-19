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
 *
 * The confirm button is the neutral outline, not red: there is no danger
 * variant in this design, and the reason field plus the code are the friction.
 */
export function DangerDialog({
  open, title, target, targetKind, consequence, confirmLabel, requireStepUp = true,
  reasonLabel = 'Reason (recorded in the audit log)', verb = 'change', onCancel, onConfirm,
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
  /** "You are about to {verb} this {targetKind}:" */
  verb?: string;
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
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      footer={(
        <>
          <Button onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !reasonOk || !totpOk}>
            {busy ? 'Working…' : confirmLabel}
          </Button>
        </>
      )}
    >
      <p className="text-body mb-2">You are about to {verb} this {targetKind}:</p>
      <p className="font-mono text-small bg-paper-2 border border-rule rounded-sm px-3 py-2.5 mb-4 break-words text-ink">
        {target}
      </p>
      <p className="text-body mb-4">{consequence}</p>

      {error && <ErrorNote>{error}</ErrorNote>}

      <Field label={reasonLabel} className="mb-4">
        <TextArea
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="At least three characters"
          autoFocus
        />
      </Field>

      {needsTotp && (
        <div>
          <p className="text-label text-ink-2 mb-1">Your authenticator code</p>
          <TotpInput value={totp} onChange={setTotp} />
          <p className="text-meta text-ink-3 mt-1">
            Step-up confirmation. Your password is not needed again.
          </p>
        </div>
      )}
    </Modal>
  );
}
