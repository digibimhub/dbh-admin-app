import { customType } from 'drizzle-orm/pg-core';

/** Case-insensitive text. Requires: CREATE EXTENSION citext; */
export const citext = customType<{ data: string }>({
  dataType: () => 'citext',
});

export const textArray = customType<{ data: string[]; driverData: string[] }>({
  dataType: () => 'text[]',
});
