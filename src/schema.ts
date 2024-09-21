import { relations } from 'drizzle-orm';
import { bigint, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';

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

// New Table: Emojis
export const emojis = pgTable('emojis', {
  id: serial('id').primaryKey(),
  symbol: text('symbol').unique(),
});

export const emojiUsage = pgTable('emoji_usage', {
  id: serial('id'),
  emojiId: bigint('emoji_id', { mode: 'number' }),
  language: text('language'),
  timestamp: timestamp('timestamp').defaultNow(),
  cursor: bigint('cursor', { mode: 'number' }),
});


export const emojiRelations = relations(emojis, ({ many }) => ({
  emojiUsage: many(emojiUsage)
}));
