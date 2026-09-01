import type { Context } from 'hono';
import { badRequest } from './errors';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * A route parameter that is about to be compared against a uuid column.
 *
 * Postgres raises on an invalid uuid literal, and a raw driver error becomes a
 * 500 `internal` — so without this a typo in a URL reads as "the server is
 * broken" rather than "that is not an id". Every `/:id` route that reaches a
 * uuid column should go through here.
 */
export function uuidParam(c: Context, name = 'id'): string {
  const value = c.req.param(name);
  if (!value || !UUID.test(value)) {
    throw badRequest(`"${name}" must be a UUID`, { [name]: 'not a valid id' });
  }
  return value;
}

/**
 * A route parameter that is not a uuid — a role key, a panel slug.
 *
 * Hono only infers `:name` into the context type on the two-argument form of a
 * route, so adding a `requireCapability` guard in front of a handler widens
 * `c.req.param('key')` to `string | undefined`. That is a typing artefact
 * rather than a real possibility — the route cannot match without the segment —
 * but narrowing it here beats a cast, and it gives a 400 rather than a crash if
 * the route is ever mounted somewhere the segment is optional.
 */
export function requiredParam(c: Context, name: string): string {
  const value = c.req.param(name);
  if (!value) throw badRequest(`"${name}" is required`, { [name]: 'missing' });
  return value;
}
