'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage } from '@/lib/api';
import { PublicShell } from '@/components/PublicShell';
import { QrCode } from '@/components/QrCode';
import { TotpInput } from '@/components/TotpInput';
import { Button, ErrorNote, Loading } from '@/components/ui';

/** The confirm may name the step still owed; an older API answers with nothing. */
type ConfirmResponse = { next?: 'password' | null } | undefined;

export default function TotpEnrolPage() {
  const [secret, setSecret] = useState('');
  const [url, setUrl] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showManual, setShowManual] = useState(false);

  useEffect(() => {
    api<{ secret: string; otpauthUrl: string }>('/admin/auth/totp/enrol', { method: 'POST' })
      .then((d) => { setSecret(d.secret); setUrl(d.otpauthUrl); })
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<ConfirmResponse>('/admin/auth/totp/confirm', { method: 'POST', body: JSON.stringify({ totp: code }) });
      // The app layout also sends anybody with `mustChangePassword` to the
      // password page, so an API that does not answer `next` still lands right.
      window.location.href = res?.next === 'password' ? '/login/password' : '/';
    } catch {
      // The API only rejects a code that does not match the pending secret.
      setError('That code was not accepted. Wait for the next one and try again.');
      setCode('');
      setBusy(false);
    }
  }

  return (
    <PublicShell>
      <form onSubmit={onSubmit} className="space-y-5">
        <div>
          <p className="text-meta text-ink-3">Step 1 of 2</p>
          <h1 className="text-page font-bold text-ink">Set up your authenticator</h1>
          <p className="text-body text-ink-2 mt-2">
            Scan this with your authenticator app, then enter one code to prove it works. Nothing is saved until that
            code checks out, so an abandoned enrolment cannot lock you out.
          </p>
        </div>

        {error && <ErrorNote>{error}</ErrorNote>}

        {!url && !error && <Loading what="Preparing your secret" />}

        {url && (
          <>
            <div className="flex justify-center">
              <QrCode value={url} size={196} label="Authenticator enrolment QR code" />
            </div>

            <Button variant="link" onClick={() => setShowManual((v) => !v)}>
              {showManual ? 'Hide manual entry' : 'Cannot scan? Enter it manually'}
            </Button>

            {showManual && (
              <div className="border border-rule rounded-sm p-3 bg-paper-2">
                <p className="text-label text-ink-2 mb-1">Secret</p>
                <p className="font-mono text-body break-all select-all mb-3">{secret}</p>
                <dl className="text-meta grid grid-cols-[80px_minmax(0,1fr)] gap-y-0.5">
                  <dt className="text-ink-3">Type</dt><dd>Time based (TOTP)</dd>
                  <dt className="text-ink-3">Algorithm</dt><dd>SHA-1</dd>
                  <dt className="text-ink-3">Digits</dt><dd>6</dd>
                  <dt className="text-ink-3">Period</dt><dd>30 seconds</dd>
                </dl>
                <p className="text-label text-ink-2 mt-3 mb-1">otpauth URI</p>
                <p className="font-mono text-micro break-all select-all text-ink-2">{url}</p>
              </div>
            )}

            <div>
              <p className="text-label text-ink-2 mb-1">Code from the app</p>
              <TotpInput value={code} onChange={setCode} disabled={busy} autoFocus />
            </div>

            <Button
              variant="primary"
              type="submit"
              disabled={busy || !/^\d{6}$/.test(code)}
              className="w-full"
            >
              {busy ? 'Confirming…' : 'Confirm and continue'}
            </Button>
          </>
        )}

        <p className="text-meta text-ink-3 border-t border-rule pt-4">
          Keep this device safe. There is no self-service recovery. If you lose it, an administrator has to clear the
          secret before you can sign in again.
        </p>
      </form>
    </PublicShell>
  );
}
