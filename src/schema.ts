import { bigint, index, pgTable, serial, text } from 'drizzle-orm/pg-core';

export const posts = pgTable('posts', {
  id: text('id').primaryKey(),
  createdAt: text('created_at'),
  did: text('did'),
  rkey: text('rkey'),
  cursor: bigint('cursor', { mode: 'number' }),
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
