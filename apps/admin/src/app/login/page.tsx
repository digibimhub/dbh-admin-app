'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError } from '@/lib/api';
import { TotpInput } from '@/components/TotpInput';
import { Turnstile } from '@/components/Turnstile';
import { Button, ErrorNote, Field, TextInput } from '@/components/ui';

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '';

/**
 * One message covers every credential outcome — a wrong password, a wrong code,
 * a reused code, an address with no account. Telling somebody which factor was
 * wrong turns a password guess into a two-step oracle, so 401 and 400 are
 * deliberately indistinguishable here.
 *
 * Being rate limited is NOT a credential outcome. It says nothing about whether
 * the address exists or the password was close, and folding it into the message
 * above means an operator who has spent their five attempts keeps typing
 * correct codes into a wall that will refuse all of them. Same for a request
 * that never reached the API at all.
 */
const GENERIC_ERROR = 'That did not work. Check your email, password and current authenticator code, then try again.';
const RATE_LIMITED = 'Too many sign-in attempts. Wait 15 minutes before trying again.';
const UNREACHABLE = 'Could not reach the server. Check that the API is running, then try again.';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [turnstileToken, setTurnstileToken] = useState('');
  const [hint, setHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The code the hint last put on screen, and the code currently in the boxes.
  // Both are read from inside a timer callback, where component state would be
  // whatever it was when the timer was armed.
  const hintRef = useRef<string | null>(null);
  const totpRef = useRef('');

  const onTotpChange = useCallback((next: string) => {
    totpRef.current = next;
    setTotp(next);
  }, []);

  /**
   * Local development convenience only; the endpoint answers { enabled: false }
   * anywhere DEV_AUTH_HINT is not set.
   *
   * This has to be re-fetched, not fetched once. A TOTP code lives for 30
   * seconds and the API accepts one step of skew either side, so a code minted
   * when the page loaded is refused by the time anybody reads it — and the
   * replay guard refuses it a second time over, because its counter has already
   * been retired. A hint that does not tick is a hint that lies.
   */
  const loadHint = useCallback(async () => {
    try {
      const d = await api<{ enabled: boolean; email?: string; password?: string; totp?: string }>(
        '/admin/auth/dev-hint',
      );
      if (!d.enabled) return;
      // Fill blanks only, so a refresh cannot take back an address someone typed
      // to sign in as a different role.
      if (d.email) setEmail((prev) => prev || d.email!);
      if (d.password) setPassword((prev) => prev || d.password!);
      if (!d.totp) return;

      // Replace the boxes only while they hold this hint's own code, or nothing.
      // Anything else is somebody typing, and a tick must not overwrite it.
      const untouched = totpRef.current === '' || totpRef.current === hintRef.current;
      hintRef.current = d.totp;
      setHint(d.totp);
      if (untouched) onTotpChange(d.totp);
    } catch {
      /* not in hint mode */
    }
  }, [onTotpChange]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;

    const tick = async () => {
      await loadHint();
      if (cancelled) return;
      // Land just inside the next window rather than on its edge: a code minted
      // in the final moments of a window is dead before it can be submitted.
      timer = setTimeout(() => { void tick(); }, 30_000 - (Date.now() % 30_000) + 750);
    };

    void tick();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [loadHint]);

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
    } catch (err) {
      if (!(err instanceof ApiError)) setError(UNREACHABLE);
      else if (err.status === 429) setError(RATE_LIMITED);
      else setError(GENERIC_ERROR);
      // The code that just failed is spent whatever the reason — its counter is
      // retired even on a wrong password. Clear it and put a live one up, or the
      // hint on screen is the one that has already been refused.
      onTotpChange('');
      void loadHint();
      setBusy(false);
    }
  }

  /*
   * Deliberately NOT `totp.length !== 6`.
   *
   * An operator who has never enrolled reaches /login/totp-enrol by posting
   * email and password with no code at all, so an empty box is a valid submit.
   * Only a half-typed code is worth blocking: it fails schema validation at the
   * API and spends one of five attempts per email per fifteen minutes to learn
   * nothing.
   */
  const partialCode = totp.length > 0 && totp.length < 6;

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
          <TotpInput value={totp} onChange={onTotpChange} disabled={busy} />
          {hint && (
            <p className="font-mono text-meta text-ink-3 mt-1.5">Local dev hint — current code: {hint}</p>
          )}
        </div>

        {SITE_KEY && <Turnstile siteKey={SITE_KEY} onToken={onToken} />}

        {error && <ErrorNote>{error}</ErrorNote>}

        <Button variant="primary" type="submit" disabled={busy || partialCode} className="w-full !py-2.5">
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
