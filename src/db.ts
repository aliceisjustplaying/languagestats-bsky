// src/db.ts
import dotenv from 'dotenv';
import { Pool } from 'pg';

import logger from './logger';

// Assuming you have a logger setup

dotenv.config();

// Initialize PostgreSQL pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20, // Maximum number of connections
  idleTimeoutMillis: 30000, // Close idle connections after 30 seconds
});

// Handle connection errors
pool.on('error', (err) => {
  logger.error('Unexpected error on idle client', err);
  process.exit(-1);
});

// TypeScript Interfaces for Tables
interface Post {
  id: string;
  created_at: string; // ISO string
  did: string;
  time_us: bigint;
  type: string;
  collection: string;
  rkey: string;
  cursor: bigint;
  is_deleted: boolean;
  embed: any; // JSONB
  reply: any; // JSONB
}

interface Language {
  post_id: string;
  language: string;
}

interface Emoji {
  emoji: string;
  count: bigint;
}

interface EmojiPerLanguage {
  language: string;
  emoji: string;
  count: bigint;
}

interface EmojiDaily {
  time: string; // YYYY-MM-DD
  emoji: string;
  count: bigint;
}

interface EmojiPerLanguageDaily {
  time: string; // YYYY-MM-DD
  language: string;
  emoji: string;
  count: bigint;
}

// Database Operations

/**
 * Saves or updates a post and its associated languages.
 * @param post The post object containing all necessary fields.
 */
export async function savePost(post: Post, languages: Language[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Insert or update the post
    const insertPostText = `
      INSERT INTO posts (id, created_at, did, time_us, type, collection, rkey, cursor, is_deleted, embed, reply)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (id) DO UPDATE SET
        created_at = EXCLUDED.created_at,
        did = EXCLUDED.did,
        time_us = EXCLUDED.time_us,
        type = EXCLUDED.type,
        collection = EXCLUDED.collection,
        rkey = EXCLUDED.rkey,
        cursor = EXCLUDED.cursor,
        is_deleted = EXCLUDED.is_deleted,
        embed = EXCLUDED.embed,
        reply = EXCLUDED.reply;
    `;
    const insertPostValues = [
      post.id,
      post.created_at,
      post.did,
      post.time_us,
      post.type,
      post.collection,
      post.rkey,
      post.cursor,
      post.is_deleted,
      post.embed,
      post.reply,
    ];
    await client.query(insertPostText, insertPostValues);

    // Insert languages
    const insertLanguageText = `
      INSERT INTO languages (post_id, language)
      VALUES ($1, $2)
      ON CONFLICT DO NOTHING;
    `;
    for (const lang of languages) {
      const insertLanguageValues = [lang.post_id, lang.language];
      await client.query(insertLanguageText, insertLanguageValues);
    }

    await client.query('COMMIT');
    logger.debug(`Saved/Updated post ${post.id}`);
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error(`Error saving/updating post ${post.id}: ${(error as Error).message}`);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Performs a soft delete of a post.
 * @param postId The ID of the post to delete.
 * @param cursor The cursor value associated with the delete operation.
 */
export async function softDeletePost(postId: string, cursor: bigint): Promise<void> {
  const client = await pool.connect();
  try {
    const updateText = `
      UPDATE posts
      SET is_deleted = TRUE, cursor = $1
      WHERE id = $2;
    `;
    const updateValues = [cursor, postId];
    await client.query(updateText, updateValues);
    logger.debug(`Soft deleted post ${postId}`);
  } catch (error) {
    logger.error(`Error soft deleting post ${postId}: ${(error as Error).message}`);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Increments emoji counts (aggregate and per-language) and time-series counts.
 * @param emoji The emoji to increment.
 * @param language The language associated with the emoji.
 * @param date The date (YYYY-MM-DD) of the emoji usage.
 */
export async function incrementEmojiData(emoji: string, language: string, date: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Update aggregate emoji count
    const upsertEmojiText = `
      INSERT INTO emojis (emoji, count)
      VALUES ($1, 1)
      ON CONFLICT (emoji) DO UPDATE SET count = emojis.count + 1;
    `;
    await client.query(upsertEmojiText, [emoji]);

    // Update per-language emoji count
    const upsertEmojiPerLanguageText = `
      INSERT INTO emojis_per_language (language, emoji, count)
      VALUES ($1, $2, 1)
      ON CONFLICT (language, emoji) DO UPDATE SET count = emojis_per_language.count + 1;
    `;
    await client.query(upsertEmojiPerLanguageText, [language, emoji]);

    // Update emojis_daily
    const upsertEmojiDailyText = `
      INSERT INTO emojis_daily (time, emoji, count)
      VALUES ($1, $2, 1)
      ON CONFLICT (time, emoji) DO UPDATE SET count = emojis_daily.count + 1;
    `;
    await client.query(upsertEmojiDailyText, [date, emoji]);

    // Update emojis_per_language_daily
    const upsertEmojiPerLanguageDailyText = `
      INSERT INTO emojis_per_language_daily (time, language, emoji, count)
      VALUES ($1, $2, $3, 1)
      ON CONFLICT (time, language, emoji) DO UPDATE SET count = emojis_per_language_daily.count + 1;
    `;
    await client.query(upsertEmojiPerLanguageDailyText, [date, language, emoji]);

    await client.query('COMMIT');
    logger.debug(`Incremented emoji data for ${emoji} in language ${language} on ${date}`);
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error(`Error incrementing emoji data for ${emoji}: ${(error as Error).message}`);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Retrieves the latest cursor from a separate table or a configuration source.
 * Implement this function based on how you track cursors.
 */
export async function getLastCursor(): Promise<bigint> {
  const client = await pool.connect();
  try {
    const res = await client.query<{ cursor: bigint }>(
      'SELECT cursor FROM cursor_table ORDER BY updated_at DESC LIMIT 1;',
    );
    if (res.rows.length > 0) {
      return res.rows[0].cursor;
    }
    return BigInt(0);
  } catch (error) {
    logger.error(`Error fetching last cursor: ${(error as Error).message}`);
    return BigInt(0);
  } finally {
    client.release();
  }
}

/**
 * Updates the latest cursor in a separate table or a configuration source.
 * Implement this function based on how you track cursors.
 */
export async function updateLastCursor(cursor: bigint): Promise<void> {
  const client = await pool.connect();
  try {
    const upsertText = `
      INSERT INTO cursor_table (cursor, updated_at)
      VALUES ($1, NOW())
      ON CONFLICT (id) DO UPDATE SET cursor = EXCLUDED.cursor, updated_at = EXCLUDED.updated_at;
    `;
    // Assuming 'cursor_table' has a single row with id = 1
    await client.query(upsertText, [cursor]);
  } catch (error) {
    logger.error(`Error updating last cursor: ${(error as Error).message}`);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Closes the database pool gracefully.
 */
export async function closeDatabase(): Promise<void> {
  await pool.end();
  logger.info('Database pool has ended');
}
