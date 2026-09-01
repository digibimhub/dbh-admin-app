import { env } from '../env';

export interface Mail {
  to: string;
  subject: string;
  body: string;
}

/**
 * Outbound mail seam.
 *
 * No SMTP client is wired up yet — that is a deployment decision, and adding
 * a transport dependency now would be guessing. Everything that needs to send
 * mail calls this, so switching to a real transport is one function body.
 *
 * The body is written to the log, so callers must keep credentials, tokens
 * and TOTP codes out of it. Nothing in this codebase mails a secret: the TOTP
 * reset flow deliberately tells the user to re-enrol rather than sending them
 * a new secret.
 */
export async function sendMail(mail: Mail): Promise<void> {
  if (!env.alertEmailTo && !env.smtpHost) {
    console.log(`[mail:skipped] ${mail.subject} (no SMTP_HOST or ALERT_EMAIL_TO configured)`);
    return;
  }
  console.log(`[mail] to=${mail.to} subject=${mail.subject}\n${mail.body}`);
}
