import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as pg from 'pg';
import dotenv from 'dotenv';

import logger from './logger.js';
import * as schema from './schema.js';
import { /*cursor, */languages, posts } from './schema.js';

dotenv.config();

const { Pool } = pg.default;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export const db = drizzle(pool, { schema });

// export async function getLastCursor(): Promise<number> {
//   logger.debug('Getting last cursor...');
//   const result = await db.select({ lastCursor: cursor.lastCursor }).from(cursor).where(eq(cursor.id, 1));
//   if (result.length === 0) {
//     logger.info('No cursor found, initializing with current epoch in microseconds...');
//     const currentEpochMicroseconds = BigInt(Date.now()) * 1000n;
//     await db
//       .insert(cursor)
//       .values({
//         id: 1,
//         lastCursor: Number(currentEpochMicroseconds),
//       })
//       .execute();
//     logger.info(`Initialized cursor with value: ${currentEpochMicroseconds}`);
//     return Number(currentEpochMicroseconds);
//   }
//   logger.info(`Returning cursor from database: ${result[0].lastCursor}`);
//   return result[0].lastCursor!;
// }

// export async function updateLastCursor(newCursor: number): Promise<void> {
//   try {
//     await db.update(cursor).set({ lastCursor: newCursor }).where(eq(cursor.id, 1));
//     logger.info(`Updated last cursor to ${newCursor}`);
//   } catch (error: unknown) {
//     logger.error(`Error updating cursor: ${(error as Error).message}`);
//   }
// }

export async function savePost(post: {
  id: string;
  created_at: Date;
  langs: Set<string>;
  did: string;
  rkey: string;
  cursor: number;
}) {
  try {
    await db.transaction(async (tx) => {
      await tx
        .insert(posts)
        .values({
          id: post.id,
          createdAt: post.created_at,
          did: post.did,
          rkey: post.rkey,
          cursor: post.cursor,
        })
        .onConflictDoNothing();

      const languageEntries = Array.from(post.langs).map((lang) => ({
        postId: post.id,
        language: lang,
      }));

      if (languageEntries.length > 0) {
        await tx.insert(languages).values(languageEntries);
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
      logger.info(`Deleted post ${postId}`);
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
