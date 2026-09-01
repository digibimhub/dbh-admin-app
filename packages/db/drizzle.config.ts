import { config } from 'dotenv';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Config } from 'drizzle-kit';

const here = fileURLToPath(new URL('.', import.meta.url));
config({ path: resolve(here, '../../.env') });
config({ path: resolve(here, '../../.env.local') });

export default {
  schema: './src/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
  verbose: true,
  strict: true,
} satisfies Config;
