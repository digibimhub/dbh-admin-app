/**
 * A connection handle that is either the pool-backed `db` or a transaction.
 *
 * `POST /v1/token/refresh` has to do five writes atomically, so every helper
 * that touches the database takes one of these instead of importing `db`
 * directly. `PgTransaction` extends `PgDatabase`, so both satisfy this type
 * without a cast.
 */
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { schema } from '@app/db';

export type Schema = typeof schema;

export type DbConn = PgDatabase<
  NodePgQueryResultHKT,
  Schema,
  ExtractTablesWithRelations<Schema>
>;
