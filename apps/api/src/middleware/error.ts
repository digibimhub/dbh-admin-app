import type { Context, Next } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { ZodError } from 'zod';
import { HttpError } from '../lib/errors';

/**
 * One error shape for the whole API:
 *   { error: { code, message, request_id } }
 *
 * Nothing here leaks a stack trace, a SQL fragment or a driver payload to the
 * client. The request id is logged on both sides so support can trace one
 * failure without the response having to carry any detail.
 */
export async function errorHandler(err: Error, c: Context) {
  const requestId = c.get('requestId') ?? 'unknown';

  if (err instanceof ZodError) {
    // Field paths and validation messages only — never the submitted values,
    // which on the login route are a password and a TOTP code.
    const fields: Record<string, string> = {};
    for (const issue of err.issues) {
      fields[issue.path.join('.') || '_'] = issue.message;
    }
    return c.json(
      { error: { code: 'validation_error', message: 'Invalid request', request_id: requestId, fields } },
      400,
    );
  }

  if (err instanceof HttpError) {
    return c.json(
      { error: { code: err.code, message: err.message, request_id: requestId, fields: err.fields } },
      err.status as ContentfulStatusCode,
    );
  }

  // Name, message and stack only. A node-postgres error also carries `detail`
  // and `parameters`, which on a constraint violation contain the column
  // values that caused it — including hashes and encrypted blobs.
  console.error(`[${requestId}] ${err.name}: ${err.message}\n${err.stack ?? ''}`);
  return c.json(
    { error: { code: 'internal', message: 'Something went wrong', request_id: requestId } },
    500,
  );
}

export async function requestId(c: Context, next: Next) {
  const id = c.req.header('x-request-id') ?? `req_${crypto.randomUUID()}`;
  c.set('requestId', id);
  c.header('x-request-id', id);
  await next();
}
