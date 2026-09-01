import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DENY_MESSAGES } from './deny-messages.ts';
import type { DenyCode } from './resolve.ts';
import { denyCode, type DenyCode as SharedDenyCode } from '@app/shared';

/**
 * The deny vocabulary is declared twice — as a TypeScript union in resolve.ts
 * (what the resolver returns) and as a Zod enum in @app/shared (what the API
 * validates and the add-in switches on). Nothing links them, so they can drift
 * silently: a code added to one side would reach a client with no message.
 * These two assertions are the link. They are compile-time only and erase at
 * runtime.
 */
type Assert<T extends true> = T;
type Eq<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type _CoreMatchesShared = Assert<Eq<DenyCode, SharedDenyCode>>;

describe('deny messages', () => {
  test('every code in the shared enum has a message and an action', () => {
    // DENY_MESSAGES is typed Record<DenyCode, ...>, so tsc already proves
    // completeness against the core union. This proves it against the wire
    // enum, which is what an add-in actually receives.
    for (const code of denyCode.options) {
      const entry = DENY_MESSAGES[code];
      assert.ok(entry, `no message for '${code}'`);
      assert.ok(entry.message.length > 10, `'${code}' message is too terse to act on`);
      assert.ok(entry.action.length > 10, `'${code}' has no actionable next step`);
    }
  });

  test('there are no orphan messages for codes the resolver cannot return', () => {
    assert.deepEqual(
      Object.keys(DENY_MESSAGES).sort(),
      [...denyCode.options].sort(),
    );
  });

  test('no message is the generic failure the spec forbids', () => {
    // "License validation failed" produces a support ticket. Each code gets its
    // own message so the user can self-solve.
    for (const [code, entry] of Object.entries(DENY_MESSAGES)) {
      assert.ok(
        !/^(license )?validation failed/i.test(entry.message),
        `'${code}' falls back to a generic failure message`,
      );
    }
  });

  test('messages leak no internals to an end user', () => {
    // These strings render in a Revit dialog on a customer workstation.
    for (const [code, entry] of Object.entries(DENY_MESSAGES)) {
      const text = `${entry.message} ${entry.action}`;
      assert.ok(!/\b(select|insert|update|null|undefined|stack|org_users|licenses)\b/i.test(text),
        `'${code}' leaks an implementation detail`);
    }
  });

  test('the machine-signal codes from the early draft are gone', () => {
    // Identity comes only from Autodesk. A 'not_domain_joined' denial would
    // mean a machine-asserted signal had reached an access decision.
    assert.equal('not_domain_joined' in DENY_MESSAGES, false);
    assert.equal(denyCode.safeParse('not_domain_joined').success, false);
  });
});
