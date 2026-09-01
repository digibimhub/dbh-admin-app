import { DENY_MESSAGES, type DenyCode } from '@app/core';

/**
 * Denials are policy outcomes, not transport failures, so every add-in
 * endpoint answers them with HTTP 200 and this body. The add-in then has one
 * code path for "you cannot work today" instead of branching on status codes.
 * 4xx/5xx stay reserved for genuinely broken requests.
 */
export interface DenialBody {
  status: 'denied';
  code: DenyCode;
  message: string;
  action: string;
  retry_after: number;
}

/** Seconds until a retry could plausibly succeed. */
const RETRY_AFTER: Partial<Record<DenyCode, number>> = {
  invalid_token: 0,            // needs a fresh sign-in, not a wait
  offline_grace_exceeded: 3600,
  pending_approval: 3600,      // an operator may approve at any moment
  // A seat can be freed at any moment, and the session stays valid meanwhile.
  seats_exhausted: 900,
  domain_not_registered: 3600,
  email_not_verified: 3600,
};

export function denial(code: DenyCode): DenialBody {
  const m = DENY_MESSAGES[code];
  return {
    status: 'denied',
    code,
    message: m.message,
    action: m.action,
    retry_after: RETRY_AFTER[code] ?? 86400,
  };
}
