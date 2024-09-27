import { bigint, index, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';

export const posts = pgTable('posts', {
  id: text('id').primaryKey(),
  createdAt: timestamp('created_at', { mode: 'date', withTimezone: true, precision: 6 }),
  did: text('did'),
  rkey: text('rkey'),
  cursor: bigint('cursor', { mode: 'number' }),
}, (table) => {
  return {
    createdAtIndex: index('created_at_idx').on(table.createdAt),
  };
});

export const languages = pgTable(
  'languages',
  {
    postId: text('post_id').references(() => posts.id, { onDelete: 'cascade' }),
    language: text('language'),
  },
  (table) => {
    return {
      postIdIdx: index('post_id_idx').on(table.postId),
      languageIdx: index('language_idx').on(table.language),
    };
  },
);

export const cursor = pgTable('cursor', {
  id: serial('id').primaryKey(),
  lastCursor: bigint('last_cursor', { mode: 'number' }),
});
