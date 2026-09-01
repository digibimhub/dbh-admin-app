import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  totpCounter, makeTotp, generateTotpSecret, totpUri,
  verifyTotp, verifyTotpWithReplay, currentTotp, DEV_TOTP_SECRET,
} from './totp.ts';

const SECRET = DEV_TOTP_SECRET;
const PERIOD_MS = 30_000;

/** A fixed instant, aligned to the start of a period so the maths is obvious. */
const T0 = 1_756_400_010_000;   // 2025-08-28T17:33:30Z, counter 58546667

describe('counter arithmetic', () => {
  test('counter is floor(ms / 1000 / 30), as the replay guard assumes', () => {
    assert.equal(totpCounter(T0), Math.floor(T0 / 1000 / 30));
    assert.equal(totpCounter(0), 0);
    assert.equal(totpCounter(29_999), 0);
    assert.equal(totpCounter(30_000), 1);
  });

  test('the counter advances exactly once per 30s period', () => {
    assert.equal(totpCounter(T0 + PERIOD_MS) - totpCounter(T0), 1);
    assert.equal(totpCounter(T0 + PERIOD_MS - 1) - totpCounter(T0), 0);
  });
});

describe('secret and enrolment URI', () => {
  test('generateTotpSecret returns a 160-bit base32 secret', () => {
    const s = generateTotpSecret();
    assert.match(s, /^[A-Z2-7]{32}$/);      // 20 bytes -> 32 base32 chars
    assert.notEqual(s, generateTotpSecret());
  });

  test('totpUri is a scannable otpauth URI carrying issuer and account', () => {
    const uri = totpUri(SECRET, 'j.smith@alec.in');
    assert.ok(uri.startsWith('otpauth://totp/'));
    assert.ok(uri.includes('issuer=DIGIBIM%20HUB'));
    assert.ok(uri.includes('period=30'));
    assert.ok(uri.includes('digits=6'));
    assert.ok(uri.includes('algorithm=SHA1'));
    assert.ok(uri.includes(encodeURIComponent('j.smith@alec.in')));
  });

  test('makeTotp generates six digits', () => {
    assert.match(makeTotp(SECRET).generate({ timestamp: T0 }), /^\d{6}$/);
  });
});

describe('verifyTotp', () => {
  test('accepts the code for the current period', () => {
    const r = verifyTotp(SECRET, currentTotp(SECRET, T0), T0);
    assert.ok(r.ok);
    assert.equal(r.counter, totpCounter(T0));
  });

  test('window 1: accepts the previous period and reports its counter', () => {
    // Users type slowly and clocks drift; one period of tolerance either side.
    const prev = currentTotp(SECRET, T0 - PERIOD_MS);
    const r = verifyTotp(SECRET, prev, T0);
    assert.ok(r.ok);
    assert.equal(r.counter, totpCounter(T0) - 1, 'must report the MINTED step, not the presented one');
  });

  test('window 1: accepts the next period and reports its counter', () => {
    const next = currentTotp(SECRET, T0 + PERIOD_MS);
    const r = verifyTotp(SECRET, next, T0);
    assert.ok(r.ok);
    assert.equal(r.counter, totpCounter(T0) + 1);
  });

  test('window 1: rejects two periods away in both directions', () => {
    assert.equal(verifyTotp(SECRET, currentTotp(SECRET, T0 - 2 * PERIOD_MS), T0).ok, false);
    assert.equal(verifyTotp(SECRET, currentTotp(SECRET, T0 + 2 * PERIOD_MS), T0).ok, false);
  });

  test('rejects a wrong code, a wrong-length code and junk', () => {
    const good = currentTotp(SECRET, T0);
    const wrong = good === '000000' ? '111111' : '000000';
    assert.equal(verifyTotp(SECRET, wrong, T0).ok, false);
    assert.equal(verifyTotp(SECRET, good.slice(0, 5), T0).ok, false);
    assert.equal(verifyTotp(SECRET, `${good}0`, T0).ok, false);
    assert.equal(verifyTotp(SECRET, 'abcdef', T0).ok, false);
    assert.equal(verifyTotp(SECRET, '', T0).ok, false);
  });

  test('a code from a different secret does not verify', () => {
    const other = generateTotpSecret();
    assert.equal(verifyTotp(SECRET, currentTotp(other, T0), T0).ok, false);
  });
});

describe('replay guard', () => {
  test('the same code cannot be used twice', () => {
    const code = currentTotp(SECRET, T0);
    const first = verifyTotpWithReplay(SECRET, code, 0, T0);
    assert.ok(first.ok);

    const second = verifyTotpWithReplay(SECRET, code, first.counter, T0);
    assert.equal(second.ok, false);
    assert.ok(!second.ok && second.reason === 'replayed');
  });

  test('a code stays rejected for the rest of its validity window', () => {
    // The dangerous case: a code lifted at step N is still cryptographically
    // valid at step N+1. Recording the MINTED step is what closes that.
    const code = currentTotp(SECRET, T0);
    const first = verifyTotpWithReplay(SECRET, code, 0, T0);
    assert.ok(first.ok);

    const laterReplay = verifyTotpWithReplay(SECRET, code, first.counter, T0 + PERIOD_MS);
    assert.ok(!laterReplay.ok && laterReplay.reason === 'replayed');
  });

  test('a stale code from before the last successful login is rejected', () => {
    const old = currentTotp(SECRET, T0 - PERIOD_MS);
    const r = verifyTotpWithReplay(SECRET, old, totpCounter(T0), T0);
    assert.ok(!r.ok && r.reason === 'replayed');
  });

  test('the next period is accepted, so a legitimate second login still works', () => {
    const first = verifyTotpWithReplay(SECRET, currentTotp(SECRET, T0), 0, T0);
    assert.ok(first.ok);

    const t1 = T0 + PERIOD_MS;
    const second = verifyTotpWithReplay(SECRET, currentTotp(SECRET, t1), first.counter, t1);
    assert.ok(second.ok);
    assert.equal(second.counter, first.counter + 1);
  });

  test('an invalid code is distinguishable from a replayed one, internally only', () => {
    // Both must surface to the client as one generic 'invalid_credentials';
    // the distinction exists for audit logging, not for the response body.
    const bad = verifyTotpWithReplay(SECRET, '000000', 0, T0);
    if (bad.ok) throw new Error('000000 unexpectedly valid for this instant');
    assert.equal(bad.reason, 'invalid');
  });

  test('a replayed code is rejected before the counter can go backwards', () => {
    const r = verifyTotpWithReplay(SECRET, currentTotp(SECRET, T0), totpCounter(T0) + 10, T0);
    assert.ok(!r.ok && r.reason === 'replayed');
  });
});
