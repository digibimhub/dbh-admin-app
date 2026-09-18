import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mismatchedRevitAccount } from './resolve.ts';

/**
 * The browser/Revit account check.
 *
 * Both sides are Autodesk's own id for the account — `Application.LoginUserId`
 * in Revit, OIDC `sub` from userinfo — so this is an exact comparison. That is
 * the point of carrying the id at all: without it the add-in sees an Autodesk
 * *handle* on one side and an email on the other, and can only infer identity
 * from the fact that Autodesk derives one from the other.
 *
 * The asymmetry below is the part worth protecting. Absent means "cannot
 * check", never "refuse", because an add-in older than the field must still be
 * able to sign in.
 */
describe('mismatchedRevitAccount', () => {
  test('the same account is not a mismatch', () => {
    assert.equal(mismatchedRevitAccount('ABCDEF123456', 'ABCDEF123456'), false);
  });

  test('two different accounts are a mismatch', () => {
    // The case this exists for: Revit signed in as one person, the browser as
    // another, and the licence resolving against whoever the browser knew.
    assert.equal(mismatchedRevitAccount('VIJAY006RV00', 'INFOC8V4K000'), true);
  });

  test('case and surrounding space do not make two accounts different', () => {
    assert.equal(mismatchedRevitAccount('  abcdef123456  ', 'ABCDEF123456'), false);
  });

  for (const absent of [null, undefined, '', '   ']) {
    test(`an absent Revit id (${JSON.stringify(absent)}) cannot check, so it does not refuse`, () => {
      // An add-in built before this field existed sends nothing, and must still
      // be able to sign in. Revit being signed out is refused by the add-in
      // itself, before this endpoint is ever reached.
      assert.equal(mismatchedRevitAccount(absent, 'ABCDEF123456'), false);
    });
  }

  test('a forged id can only refuse its own sign-in, never widen anything', () => {
    // The value is client-asserted, which is why it is not an access decision:
    // identity still comes only from the code exchange. Sending somebody else's
    // id cannot impersonate them - the account that authenticated is whatever
    // Autodesk says it is, and a wrong claim simply refuses this sign-in.
    assert.equal(mismatchedRevitAccount('SOMEONE-ELSES-ID', 'ABCDEF123456'), true);

    // And sending the *right* id buys nothing either: it merely declines to
    // refuse, which is what an add-in that sent nothing already gets.
    assert.equal(mismatchedRevitAccount('ABCDEF123456', 'ABCDEF123456'), false);
  });
});
