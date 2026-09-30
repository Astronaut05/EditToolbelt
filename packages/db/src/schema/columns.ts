/**
 * Column helpers shared by every table (docs/04-data-model.md → Conventions):
 * UUIDv7 ids from Postgres 18's own `uuidv7()`, `timestamptz` times.
 */
import { sql } from 'drizzle-orm';
import { customType, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Case-insensitive text (the `citext` extension): emails compare without case. */
export const citext = customType<{ data: string }>({
  dataType: () => 'citext',
});

/** Primary key: a time-sortable UUIDv7 the database generates. */
export const id = () =>
  uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`);

/** A `timestamptz` column. */
export const tstz = (name: string) => timestamp(name, { withTimezone: true });

export const createdAt = () => tstz('created_at').notNull().defaultNow();

export const updatedAt = () =>
  tstz('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
