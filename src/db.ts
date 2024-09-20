import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

import logger from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.resolve(__dirname, '../data/posts.db');
const db = new Database(dbPath);

logger.info(`Initializing database schema...`);

db.exec(`
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY,
    created_at TEXT,
    did TEXT,
    rkey TEXT,
    cursor INTEGER,
    text TEXT
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
`);

const currentEpochMicroseconds = BigInt(Date.now()) * 1000n;

db.exec(`INSERT OR IGNORE INTO cursor (id, last_cursor) VALUES (1, ${currentEpochMicroseconds});`);

logger.info(`Setting database pragmas...`);

db.pragma('journal_mode = WAL'); // Better write concurrency
db.pragma('synchronous = NORMAL'); // Balances performance with durability
db.pragma('cache_size = -524288'); // Adjust based on system memory (512MB)
db.pragma('temp_store = MEMORY'); // Store temporary data in memory for better performance
db.pragma('locking_mode = NORMAL'); // Allows better concurrency

logger.info(`Database schema initialized.`);

const insertPost = db.prepare(`
  INSERT OR IGNORE INTO posts (id, created_at, did, rkey, cursor, text)
  VALUES (@id, @created_at, @did, @rkey, @cursor, @text)
`);

const insertLanguage = db.prepare(`
  INSERT INTO languages (post_id, language)
  VALUES (@post_id, @language)
`);

export function getLastCursor(): number {
  logger.info('Getting last cursor...');
  const row = db.prepare(`SELECT last_cursor FROM cursor WHERE id = 1`).get();
  logger.info(`Returning cursor from database: ${row.last_cursor}`);
  return row.last_cursor;
}

export function updateLastCursor(newCursor: number): void {
  const result = db
    .prepare(`UPDATE cursor SET last_cursor = @last_cursor WHERE id = 1`)
    .run({ last_cursor: newCursor });
  if (result.changes > 0) {
    logger.info(`Updated last cursor to ${newCursor}`);
  } else {
    logger.warn(`Failed to update cursor to ${newCursor}`);
  }
}
export function savePost(post: {
  id: string;
  created_at: string;
  langs: Set<string>;
  did: string;
  rkey: string;
  cursor: number;
  text: string;
}) {
  const insertOrUpdate = db.transaction((postData: typeof post) => {
    insertPost.run({
      id: postData.id,
      created_at: postData.created_at,
      did: postData.did,
      rkey: postData.rkey,
      cursor: postData.cursor,
      text: postData.text,
    });

    postData.langs.forEach((lang) => {
      insertLanguage.run({
        post_id: postData.id,
        language: lang,
      });
    });

    logger.debug(`Saved/Updated post ${postData.id}`);
  });

  try {
    insertOrUpdate(post);
  } catch (error) {
    logger.error(`Database insertion/update error: ${(error as Error).message}`, { post });
  }
}

export function deletePost(postId: string): boolean {
  try {
    const info = db.prepare(`DELETE FROM posts WHERE id = @id`).run({ id: postId });
    if (info.changes > 0) {
      logger.info(`Deleted post ${postId}`);
      return true;
    } else {
      logger.info(`Attempted to delete non-existent post ${postId}`);
      return false;
    }
  } catch (error) {
    logger.error(`Error deleting post: ${(error as Error).message}`, { postId });
    return false;
  }
}

export function closeDatabase() {
  try {
    db.close();
    logger.info('Database connection closed.');
  } catch (error) {
    logger.error(`Error closing database: ${(error as Error).message}`);
  }
}
