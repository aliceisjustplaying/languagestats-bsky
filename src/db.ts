import Database from 'better-sqlite3';
import path from 'path';
import logger from './logger';

const dbPath = path.resolve(__dirname, '../data/posts.db');
const db = new Database(dbPath);

logger.info(`Initializing database schema...`);

db.exec(`
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY,
    created_at TEXT,
    did TEXT,
    time_us INTEGER,
    type TEXT,
    collection TEXT,
    rkey TEXT,
    cursor INTEGER,
    is_deleted BOOLEAN DEFAULT FALSE,
    embed TEXT,    -- Serialized embed data
    reply TEXT     -- Serialized reply data
  );

  CREATE TABLE IF NOT EXISTS languages (
    post_id TEXT,
    language TEXT,
    FOREIGN KEY(post_id) REFERENCES posts(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_languages_language ON languages(language);

  CREATE TABLE IF NOT EXISTS cursor (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    last_cursor INTEGER
  );

  INSERT OR IGNORE INTO cursor (id, last_cursor) VALUES (1, 0);
`);

logger.info(`Database schema initialized.`);

const insertPost = db.prepare(`
  INSERT OR IGNORE INTO posts (id, created_at, did, time_us, type, collection, rkey, cursor, embed, reply)
  VALUES (@id, @created_at, @did, @time_us, @type, @collection, @rkey, @cursor, @embed, @reply)
`);

const updatePost = db.prepare(`
  UPDATE posts
  SET created_at = @created_at,
      did = @did,
      time_us = @time_us,
      type = @type,
      collection = @collection,
      rkey = @rkey,
      cursor = @cursor,
      is_deleted = @is_deleted,
      embed = @embed,
      reply = @reply
  WHERE id = @id
`);

const softDeletePostStmt = db.prepare(`
  UPDATE posts
  SET is_deleted = TRUE, cursor = @cursor
  WHERE id = @id
`);

const insertLanguage = db.prepare(`
  INSERT INTO languages (post_id, language)
  VALUES (@post_id, @language)
`);

const getLastCursorStmt = db.prepare(`SELECT last_cursor FROM cursor WHERE id = 1`);
const updateCursorStmt = db.prepare(`UPDATE cursor SET last_cursor = @last_cursor WHERE id = 1`);

export function getLastCursor(): number {
  const row = getLastCursorStmt.get();
  return row ? row.last_cursor : 0;
}

export function updateLastCursor(newCursor: number): void {
  updateCursorStmt.run({ last_cursor: newCursor });
  logger.debug(`Updated last cursor to ${newCursor}`);
}

export function savePost(post: {
  id: string;
  created_at: string;
  langs: string[];
  did: string;
  time_us: number;
  type: string;
  collection: string;
  rkey: string;
  cursor: number;
  embed?: any;   // Optional field
  reply?: any;   // Optional field
}) {
  const insertOrUpdate = db.transaction((postData: typeof post) => {
    insertPost.run({
      id: postData.id,
      created_at: postData.created_at,
      did: postData.did,
      time_us: postData.time_us,
      type: postData.type,
      collection: postData.collection,
      rkey: postData.rkey,
      cursor: postData.cursor,
      embed: postData.embed ? JSON.stringify(postData.embed) : null,   // Serialize embed
      reply: postData.reply ? JSON.stringify(postData.reply) : null,   // Serialize reply
    });

    postData.langs.forEach((lang) => {
      if (typeof lang === 'string') {
        insertLanguage.run({
          post_id: postData.id,
          language: lang,
        });
      } else {
        logger.warn(`Invalid language type: ${typeof lang} for lang: ${lang}`, { lang });
      }
    });

    logger.debug(`Saved/Updated post ${postData.id}`);
  });

  try {
    if (typeof post.id !== 'string' || post.id.trim() === '') {
      throw new Error('Invalid or missing "id"');
    }
    if (typeof post.created_at !== 'string') {
      throw new Error('Invalid "created_at"');
    }
    if (!Array.isArray(post.langs)) {
      throw new Error('Invalid "langs"');
    }
    if (typeof post.did !== 'string') {
      throw new Error('Invalid "did"');
    }
    if (typeof post.time_us !== 'number') {
      throw new Error('Invalid "time_us"');
    }
    if (typeof post.type !== 'string') {
      throw new Error('Invalid "type"');
    }
    if (typeof post.collection !== 'string') {
      throw new Error('Invalid "collection"');
    }
    if (typeof post.rkey !== 'string') {
      throw new Error('Invalid "rkey"');
    }
    if (typeof post.cursor !== 'number') {
      throw new Error('Invalid "cursor"');
    }

    insertOrUpdate(post);
  } catch (error) {
    logger.error(`Database insertion/update error: ${(error as Error).message}`, { post });
  }
}

export function softDeletePost(postId: string, cursor: number) {
  try {
    const info = softDeletePostStmt.run({
      id: postId,
      cursor: cursor,
    });
    if (info.changes > 0) {
      logger.debug(`Soft deleted post ${postId}`);
    } else {
      logger.warn(`Attempted to soft delete non-existent post ${postId}`);
    }
  } catch (error) {
    logger.error(`Error soft deleting post: ${(error as Error).message}`, { postId });
  }
}

export function purgeOldPosts(days: number) {
  const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const stmt = db.prepare(`DELETE FROM posts WHERE created_at < ? AND is_deleted = TRUE`);
  const info = stmt.run(cutoffDate);
  logger.info(`Purged ${info.changes} soft-deleted posts older than ${days} days.`);
}

// Schedule periodic purging (e.g., every hour)
const PURGE_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const PURGE_DAYS_ENV = parseInt(process.env.PURGE_DAYS || '7', 10);

const purgeInterval = setInterval(() => {
  purgeOldPosts(PURGE_DAYS_ENV);
}, PURGE_INTERVAL_MS);

export function closeDatabase() {
  clearInterval(purgeInterval);
  db.close();
  logger.info('Database connection closed.');
}
