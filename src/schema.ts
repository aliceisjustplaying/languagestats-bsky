import { bigint, pgTable, serial, text } from 'drizzle-orm/pg-core';

export const posts = pgTable('posts', {
  id: text('id').primaryKey(),
  createdAt: text('created_at'),
  did: text('did'),
  rkey: text('rkey'),
  cursor: bigint('cursor', { mode: 'number' }),
  text: text('text'),
});

export const languages = pgTable('languages', {
  postId: text('post_id').references(() => posts.id, { onDelete: 'cascade' }),
  language: text('language'),
});

export const cursor = pgTable('cursor', {
  id: serial('id').primaryKey(),
  lastCursor: bigint('last_cursor', { mode: 'number' }),
});
