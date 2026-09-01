import { config } from 'dotenv';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

const here = fileURLToPath(new URL('.', import.meta.url));
config({ path: resolve(here, '../../../.env') });
config({ path: resolve(here, '../../../.env.local') });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is not set');

export const pool = new Pool({ connectionString, max: 10 });
export const db = drizzle(pool, { schema });
export { schema };
export type Db = typeof db;
