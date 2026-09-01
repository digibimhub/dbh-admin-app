'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage } from '@/lib/api';
import { QrCode } from '@/components/QrCode';
import { TotpInput } from '@/components/TotpInput';
import { Button, ErrorNote, Loading } from '@/components/ui';

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
      await api('/admin/auth/totp/confirm', { method: 'POST', body: JSON.stringify({ totp: code }) });
      window.location.href = '/';
    } catch {
      // The API only rejects a code that does not match the pending secret.
      setError('That code was not accepted. Wait for the next one and try again.');
      setCode('');
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <form onSubmit={onSubmit} className="w-full max-w-md bg-card border border-rule rounded-md p-8">
        <p className="text-micro tracking-[0.12em] uppercase text-signal font-medium mb-2">Step 2 of 2</p>
        <h1 className="font-semibold text-page tracking-tight mb-1">Enrol your authenticator</h1>
        <p className="text-body text-ink-2 mb-5">
          Scan this with your authenticator app, then enter one code to prove it works. Nothing is saved until that
          code checks out, so an abandoned enrolment cannot lock you out.
        </p>

        {error && <ErrorNote>{error}</ErrorNote>}

        {!url && !error && <Loading what="Preparing your secret" />}

        {url && (
          <>
            <div className="flex justify-center mb-4">
              <QrCode value={url} size={196} label="Authenticator enrolment QR code" />
            </div>

            <button
              type="button"
              onClick={() => setShowManual((v) => !v)}
              className="text-micro uppercase tracking-wider text-signal hover:underline mb-3"
            >
              {showManual ? 'Hide manual entry' : 'Cannot scan? Enter it manually'}
            </button>

            {showManual && (
              <div className="mb-4 border border-rule rounded-sm p-3 bg-paper-2">
                <p className="text-micro uppercase tracking-[0.1em] text-ink-3 mb-1">Secret</p>
                <p className="font-mono text-body break-all select-all mb-3">{secret}</p>
                <dl className="text-meta grid grid-cols-[80px_minmax(0,1fr)] gap-y-0.5">
                  <dt className="text-ink-3">Type</dt><dd>Time based (TOTP)</dd>
                  <dt className="text-ink-3">Algorithm</dt><dd>SHA-1</dd>
                  <dt className="text-ink-3">Digits</dt><dd>6</dd>
                  <dt className="text-ink-3">Period</dt><dd>30 seconds</dd>
                </dl>
                <p className="text-micro uppercase tracking-[0.1em] text-ink-3 mt-3 mb-1">otpauth URI</p>
                <p className="font-mono text-micro break-all select-all text-ink-2">{url}</p>
              </div>
            )}

            <p className="text-micro uppercase tracking-[0.1em] text-ink-3 mb-1">Code from the app</p>
            <TotpInput value={code} onChange={setCode} disabled={busy} autoFocus />

            <Button
              variant="primary"
              type="submit"
              disabled={busy || !/^\d{6}$/.test(code)}
              className="w-full !py-2.5 mt-4"
            >
              {busy ? 'Confirming…' : 'Confirm and continue'}
            </Button>
          </>
        )}

        <p className="text-meta text-ink-3 mt-5 border-t border-rule pt-4">
          Keep this device safe. There is no self-service recovery — if you lose it, an administrator has to clear the
          secret before you can sign in again.
        </p>
      </form>
    </main>
  );
}
