import dotenv from 'dotenv';
import { eq, ExtractTablesWithRelations } from 'drizzle-orm';
import { drizzle, NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import emojiRegex from 'emoji-regex';
import * as pg from 'pg';

import logger from './logger.js';
import * as schema from './schema.js';
import {
  cursor,
  emojiUsage,
  emojis,
  languages,
  posts,
} from './schema.js';
import { PgTransaction } from 'drizzle-orm/pg-core';

dotenv.config();

const { Pool } = pg.default;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export const db = drizzle(pool, { schema });

// In-memory Emoji Cache
export const emojiCache = new Map<string, number>();

// Preload Emoji Cache
async function preloadEmojiCache(tx: PgTransaction<NodePgQueryResultHKT, typeof schema, ExtractTablesWithRelations<typeof schema>>) {
  const allEmojis = await tx.select({ symbol: emojis.symbol, id: emojis.id }).from(emojis);
  allEmojis.forEach((emoji: { symbol: string | null; id: number }) => {
    if (emoji.symbol) {
      emojiCache.set(emoji.symbol, emoji.id);
    }
  });
}

export async function getLastCursor(): Promise<number> {
  logger.debug('Getting last cursor...');
  const result = await db.select({ lastCursor: cursor.lastCursor }).from(cursor).where(eq(cursor.id, 1));
  if (result.length === 0) {
    logger.info('No cursor found, initializing with current epoch in microseconds...');
    const currentEpochMicroseconds = BigInt(Date.now()) * 1000n;
    await db
      .insert(cursor)
      .values({
        id: 1,
        lastCursor: Number(currentEpochMicroseconds),
      })
      .execute();
    logger.info(`Initialized cursor with value: ${currentEpochMicroseconds}`);
    return Number(currentEpochMicroseconds);
  }
  logger.info(`Returning cursor from database: ${result[0].lastCursor}`);
  return result[0].lastCursor!;
}

export async function updateLastCursor(newCursor: number): Promise<void> {
  try {
    await db.update(cursor).set({ lastCursor: newCursor }).where(eq(cursor.id, 1));
    logger.info(`Updated last cursor to ${newCursor}`);
  } catch (error: unknown) {
    logger.error(`Error updating cursor: ${(error as Error).message}`);
  }
}

export async function savePost(post: {
  id: string;
  created_at: string;
  langs: Set<string>;
  did: string;
  rkey: string;
  cursor: number;
  text: string;
}) {
  try {
    await db.transaction(async (tx) => {
      // Preload Emoji Cache
      await preloadEmojiCache(tx);

      // Insert Post
      await tx
        .insert(posts)
        .values({
          id: post.id,
          createdAt: post.created_at,
          did: post.did,
          rkey: post.rkey,
          cursor: post.cursor,
          text: post.text,
        })
        .onConflictDoNothing();

      // Insert Languages
      const languageEntries = Array.from(post.langs).map((lang) => ({
        postId: post.id,
        language: lang,
      }));

      if (languageEntries.length > 0) {
        await tx.insert(languages).values(languageEntries);
      }

      // Extract Emojis
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
      const regex = emojiRegex();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      const emojisFound = post.text.match(regex) ?? [];
      const uniqueEmojis = Array.from(new Set(emojisFound));

      // Identify New Emojis
      const newEmojis = uniqueEmojis.filter((symbol) => !emojiCache.has(symbol));

      // Bulk Insert New Emojis
      let insertedEmojis: { symbol: string | null; id: number }[] = [];
      if (newEmojis.length > 0) {
        insertedEmojis = await tx
          .insert(emojis)
          .values(newEmojis.map((symbol) => ({ symbol })))
          .onConflictDoNothing()
          .returning();

        // Update Cache with Inserted Emojis
        insertedEmojis.forEach((emoji: { symbol: string | null; id: number }) => {
          emojiCache.set(emoji.symbol!, emoji.id);
        });
      }

      // Fetch IDs for Newly Inserted or Existing Emojis
      const allEmojis = uniqueEmojis.map((symbol) => ({
        symbol,
        id: emojiCache.get(symbol)!,
      }));

      // Prepare EmojiUsage Records
      const emojiUsageRecords: { emojiId: number; language: string; timestamp: Date; cursor: number }[] = [];
      allEmojis.forEach(({ id }) => {
        post.langs.forEach((language) => {
          emojiUsageRecords.push({
            emojiId: id,
            language,
            timestamp: new Date(),
            cursor: post.cursor,
          });
        });
      });

      // Bulk Insert EmojiUsage Records
      if (emojiUsageRecords.length > 0) {
        await tx.insert(emojiUsage).values(emojiUsageRecords);
      }

      logger.debug(`Saved/Updated post ${post.id}`);
    });
  } catch (error) {
    logger.error(`Database insertion/update error: ${(error as Error).message}`, { post });
  }
}

export async function deletePost(postId: string): Promise<boolean> {
  try {
    const result = await db.delete(posts).where(eq(posts.id, postId)).returning();
    if (result.length > 0) {
      logger.debug(`Deleted post ${postId}`);
      return true;
    } else {
      logger.debug(`Attempted to delete non-existent post ${postId}`);
      return false;
    }
  } catch (error) {
    logger.error(`Error deleting post: ${(error as Error).message}`, { postId });
    return false;
  }
}

export async function closeDatabase(): Promise<void> {
  try {
    await pool.end();
    logger.info('Database connection closed.');
  } catch (error) {
    logger.error(`Error closing database: ${(error as Error).message}`);
  }
}

// // Aggregated Data Retrieval
// export async function getAllTimeEmojiStats() {
//   return db.select().from(emojiAllTimeStats);
// }

// export async function getEmojiStatsByLanguage(language: string) {
//   return db.select().from(emojiLanguageStats).where(eq(emojiLanguageStats.language, language));
// }

// export async function getDailyTopEmojis(language: string, limit = 10) {
//   return db
//     .select()
//     .from(emojiDailyStats)
//     .where(eq(emojiDailyStats.language, language))
//     .orderBy(desc(emojiDailyStats.dailyCount))
//     .limit(limit);
// }
