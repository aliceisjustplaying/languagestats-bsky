// src/backfill.ts
import dotenv from 'dotenv';
import { Pool } from 'pg';

import { incrementEmojiData, savePost } from './db';
import logger from './logger';
import { Language, Post } from './types';
import { extractEmojis } from './utils';

dotenv.config();

// Initialize PostgreSQL pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
});

// Handle connection errors
pool.on('error', (err) => {
  logger.error('Unexpected error on idle client', err);
  process.exit(-1);
});

/**
 * Retrieves all non-deleted posts from the database.
 * @returns Array of Post objects.
 */
async function getAllPosts(): Promise<{ id: string; embed: any; langs: string[]; time_us: bigint }[]> {
  try {
    const res = await pool.query(`
      SELECT id, embed, langs, time_us
      FROM posts
      WHERE is_deleted = FALSE;
    `);
    return res.rows.map((row) => ({
      id: row.id,
      embed: row.embed,
      langs: row.langs,
      time_us: BigInt(row.time_us),
    }));
  } catch (error) {
    logger.error(`Error fetching posts: ${(error as Error).message}`);
    throw error;
  }
}

/**
 * Backfills emoji statistics from existing posts.
 */
async function backfillEmojiStatistics() {
  logger.info('Starting backfill of emoji statistics...');

  try {
    const posts = await getAllPosts();
    logger.info(`Processing ${posts.length} posts...`);

    for (let i = 0; i < posts.length; i++) {
      const post = posts[i];
      const { id, embed, langs, time_us } = post;

      // Extract post content from 'embed'
      let postContent = '';
      if (embed && typeof embed === 'object') {
        // Adjust based on actual 'embed' structure
        postContent = embed.text || '';
      }

      const emojis = extractEmojis(postContent);
      const currentDate = getCurrentDate(time_us);

      // Prepare Post and Language objects
      const postObj: Post = {
        id: id,
        created_at: new Date(Number(time_us) / 1000).toISOString(),
        did: 'unknown', // Replace with actual 'did' if available
        time_us: time_us,
        type: 'unknown', // Replace with actual 'type' if available
        collection: 'app.bsky.feed.post',
        rkey: 'unknown', // Replace with actual 'rkey' if available
        cursor: time_us,
        is_deleted: false,
        embed: embed,
        reply: null, // Replace if available
      };

      const languageObjs: Language[] = langs.map((lang) => ({
        post_id: id,
        language: lang,
      }));

      // Save post and languages
      await savePost(postObj, languageObjs);

      // Update Emoji Statistics
      for (const emoji of emojis) {
        for (const lang of langs) {
          await incrementEmojiData(emoji, lang, currentDate);
        }
      }

      if ((i + 1) % 1000 === 0) {
        logger.info(`Processed ${i + 1} posts...`);
      }
    }

    logger.info('Backfill of emoji statistics completed.');
  } catch (error) {
    logger.error(`Error during backfill: ${(error as Error).message}`);
  } finally {
    await pool.end();
    logger.info('Database pool has ended');
  }
}

/**
 * Converts a timestamp to 'YYYY-MM-DD' format.
 * @param time_us Timestamp in microseconds.
 * @returns Date string in 'YYYY-MM-DD' format.
 */
function getCurrentDate(time_us: bigint): string {
  const date = new Date(Number(time_us) / 1000);
  const year = date.getFullYear();
  const month = `0${date.getMonth() + 1}`.slice(-2);
  const day = `0${date.getDate()}`.slice(-2);
  return `${year}-${month}-${day}`;
}

// Execute the backfill
backfillEmojiStatistics();
