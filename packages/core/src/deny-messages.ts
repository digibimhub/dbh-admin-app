import type { DenyCode } from './resolve';

export const DENY_MESSAGES: Record<DenyCode, { message: string; action: string }> = {
  email_not_verified: {
    message: 'Autodesk has not verified this email address, so it cannot be mapped to a licence.',
    action: 'Verify the email on your Autodesk account, then try Sign in again.',
  },
  domain_not_registered: {
    message: 'This email domain is not registered to an active licence.',
    action: 'Ask your BIM manager to approve the request, or contact support.',
  },
  pending_approval: {
    message: 'Access for this account is waiting on approval.',
    action: 'Your BIM manager can approve this at the admin portal.',
  },
  /**
   * Deliberately not phrased as a rejection. The person is a member of the
   * right organisation with the right role; the licence simply has no free
   * seat for it. Their session stays valid, so the moment a seat is freed the
   * next check succeeds without signing in again.
   */
  seats_exhausted: {
    message: 'Your organisation has no free seat for your role on its current licence.',
    action: 'Your BIM manager can free a seat or raise the count at the admin portal. You do not need to sign in again.',
  },
  /**
   * Also a wait, not a refusal: the organisation asked to approve newcomers
   * by hand. Nothing the person can do speeds it up, so the action names who
   * can.
   */
  awaiting_approval: {
    message: 'Your organisation approves new members before they can use the add-in, and your request is waiting.',
    action: 'Your organisation admin can approve it at the admin portal. Sign in again once they have.',
  },
  /**
   * The one membership outcome that is a decision against the person. Said
   * plainly, with the way back — an organisation admin can re-open it — and
   * without the note the reviewer wrote, which was written for the portal.
   */
  membership_rejected: {
    message: 'Your organisation admin has turned down your request to use the add-in.',
    action: 'Ask your organisation admin if you believe this is a mistake. They can re-open the request at the admin portal.',
  },
  /**
   * The user can fix this one entirely by themselves, so the action says how
   * rather than pointing at an operator who has nothing to do with it.
   */
  revit_account_mismatch: {
    message: 'That browser is signed in to a different Autodesk account than Revit is.',
    action: 'Sign out at accounts.autodesk.com, then sign in again as the account shown at the top right of Revit. Nothing was changed and no seat was used.',
  },
  user_disabled: {
    message: 'This account has been disabled.',
    action: 'Contact your BIM manager if this is unexpected.',
  },
  device_disabled: {
    message: 'This machine has been blocked from using the add-in.',
    action: 'Contact your BIM manager if this is unexpected.',
  },
  org_suspended: {
    message: 'This organisation is currently suspended.',
    action: 'Contact support.',
  },
  license_missing: {
    message: 'No active licence was found for this organisation.',
    action: 'Contact support.',
  },
  license_suspended: {
    message: 'The organisation licence is suspended.',
    action: 'Contact support.',
  },
  license_expired: {
    message: 'The organisation licence has ended.',
    action: 'Ask your BIM manager about renewal.',
  },
  license_not_started: {
    message: 'The organisation licence has not started yet.',
    action: 'Try again on the start date, or contact support.',
  },
  offline_grace_exceeded: {
    message: 'This machine has been offline longer than the allowed grace period.',
    action: 'Connect to the network and use Check access.',
  },
  invalid_token: {
    message: 'This session is no longer valid.',
    action: 'Sign in again from the License panel.',
  },
};
