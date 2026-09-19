import { mismatchedRevitAccount } from '@app/core';

/**
 * One line per comparison of Revit's signed-in account against the Autodesk
 * account the server actually knows, so the pair can be read from the API log.
 *
 * Nobody has yet observed `Application.LoginUserId` next to userinfo's `sub`
 * on a real sign-in — both are documented as Autodesk's id for the account,
 * but the comparison in `mismatchedRevitAccount` rests on them being the same
 * string. Until a real pair has been seen this line is the evidence; after it
 * has, it is the audit trail for a refusal.
 *
 * Logs identifiers only. Never the access token, refresh token, handoff, or
 * anything from the APS exchange.
 */
export function logRevitAccountCheck(
  where: 'callback' | 'exchange' | 'refresh',
  revitLoginUserId: string | null | undefined,
  autodeskId: string,
  email: string | null | undefined,
): boolean {
  const claimed = revitLoginUserId?.trim() || null;
  const mismatch = mismatchedRevitAccount(claimed, autodeskId);
  const verdict = !claimed
    ? 'unchecked (add-in sent no revitLoginUserId)'
    : mismatch ? 'MISMATCH — refused' : 'match';

  const line = `[addin:revit-account] ${where}: revit_login_user_id=${claimed ?? '(none)'} `
    + `autodesk_id=${autodeskId} email=${email ?? '(none)'} -> ${verdict}`;
  if (mismatch) console.warn(line);
  else console.info(line);
  return mismatch;
}
