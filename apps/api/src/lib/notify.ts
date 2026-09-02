import { env } from '../env';

/**
 * Outbound chat notification for a Slack or Microsoft Teams incoming webhook.
 *
 * One body shape serves both. A Slack incoming webhook and a Teams one both
 * accept a JSON object with a `text` field and render it as a plain message,
 * so `{ text }` is the whole payload and nothing here needs to know which
 * product is on the other end of the URL. Resist adding Slack `blocks` or a
 * Teams `MessageCard`: either one breaks the other vendor.
 *
 * **Fail-open, and never throw.** A missed notification is an operator
 * inconvenience; an exception escaping this function would be an add-in
 * sign-in that fails or a scheduled job that aborts half-done because a chat
 * server was slow. That trade is never worth taking, so every failure path —
 * unset URL, timeout, DNS, a 500 from the webhook — returns `false` and logs.
 * This is the opposite of `verifyTurnstile`, which fails closed because there
 * an unreachable service really is an authorisation question.
 *
 * The timeout is not optional: without `AbortSignal.timeout` a hung webhook
 * would hold the caller — and, for a job, its database transaction and its
 * advisory lock — open for the platform default of minutes.
 *
 * Nothing secret may go in `text`. It is written to the log on the disabled
 * path (the same rule `mailer.ts` carries) and it lands in a chat channel,
 * which is a wider audience than the log.
 *
 * @returns whether the message was accepted by the webhook.
 */
export async function postWebhook(text: string): Promise<boolean> {
  if (!env.notifyWebhookUrl) {
    console.log(`[notify:skipped] no NOTIFY_WEBHOOK_URL configured\n${text}`);
    return false;
  }

  try {
    const res = await fetch(env.notifyWebhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // Both Slack and Teams read `text`. Keep it exactly this simple.
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      console.error(`[notify] webhook responded ${res.status}`);
      return false;
    }
    return true;
  } catch (e: unknown) {
    console.error(`[notify] webhook failed: ${redact(e instanceof Error ? e.message : String(e))}`);
    return false;
  }
}

/**
 * The webhook URL is itself the credential — anyone holding it can post to the
 * channel — so it must never reach the log. Most fetch failures say only
 * "fetch failed", but a malformed URL is reported as "Failed to parse URL from
 * <the whole secret>", which is exactly the case this exists for.
 */
function redact(message: string): string {
  if (!env.notifyWebhookUrl) return message;
  return message.split(env.notifyWebhookUrl).join('<NOTIFY_WEBHOOK_URL>');
}
