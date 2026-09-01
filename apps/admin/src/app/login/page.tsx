'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { TotpInput } from '@/components/TotpInput';
import { Turnstile } from '@/components/Turnstile';
import { Button, ErrorNote, Field, TextInput } from '@/components/ui';

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '';

/**
 * One message covers every failure. Telling somebody which factor was wrong
 * turns a password guess into a two-step oracle.
 */
const GENERIC_ERROR = 'That did not work. Check your email, password and current authenticator code, then try again.';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [turnstileToken, setTurnstileToken] = useState('');
  const [hint, setHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Local development convenience only; the endpoint answers { enabled: false }
    // anywhere DEV_AUTH_HINT is not set.
    api<{ enabled: boolean; email?: string; password?: string; totp?: string }>('/admin/auth/dev-hint')
      .then((d) => {
        if (!d.enabled) return;
        if (d.email) setEmail(d.email);
        if (d.password) setPassword(d.password);
        if (d.totp) { setHint(d.totp); setTotp(d.totp); }
      })
      .catch(() => { /* not in hint mode */ });
  }, []);

  const onToken = useCallback((token: string) => setTurnstileToken(token), []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ needsEnrol: boolean }>('/admin/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          password,
          totp: totp || undefined,
          turnstile: turnstileToken || undefined,
        }),
      });
      window.location.href = res.needsEnrol ? '/login/totp-enrol' : '/';
    } catch {
      setError(GENERIC_ERROR);
      setTotp('');
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <form onSubmit={onSubmit} className="w-full max-w-md bg-card border border-rule rounded-md p-8">
        <p className="text-micro tracking-[0.12em] uppercase text-signal font-medium mb-2">DIGIBIM HUB</p>
        <h1 className="font-semibold text-page tracking-tight mb-1">Sign in</h1>
        <p className="text-ink-2 text-body mb-6">Licensing administration.</p>

        <Field label="Email" className="mb-4">
          <TextInput
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
           
            required
          />
        </Field>

        <Field label="Password" className="mb-4">
          <TextInput
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </Field>

        <div className="mb-4">
          <p className="text-micro uppercase tracking-[0.1em] text-ink-3 mb-1">Authenticator code</p>
          <TotpInput value={totp} onChange={setTotp} disabled={busy} />
          {hint && (
            <p className="font-mono text-meta text-ink-3 mt-1.5">Local dev hint — current code: {hint}</p>
          )}
        </div>

        {SITE_KEY && <Turnstile siteKey={SITE_KEY} onToken={onToken} />}

        {error && <ErrorNote>{error}</ErrorNote>}

        <Button variant="primary" type="submit" disabled={busy} className="w-full !py-2.5">
          {busy ? 'Signing in…' : 'Continue'}
        </Button>

        <p className="text-body text-ink-2 mt-5 border-t border-rule pt-4">
          <b>Lost your authenticator? Contact an administrator.</b>
          <span className="block text-ink-3 text-meta mt-1">
            There is no self-service reset. An operator clears it for you, and you enrol a new device at your next
            sign-in.
          </span>
        </p>
      </form>
    </main>
  );
}
