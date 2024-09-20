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

logger.info(`Creating index on posts(created_at, is_deleted)...`);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_posts_created_at_is_deleted 
  ON posts(created_at, is_deleted);
`);

logger.info(`Setting database pragmas...`);

db.pragma('journal_mode = WAL'); // Better write concurrency
db.pragma('synchronous = NORMAL'); // Balances performance with durability
db.pragma('cache_size = -524288'); // Adjust based on system memory (512MB)
db.pragma('temp_store = MEMORY'); // Store temporary data in memory for better performance
db.pragma('locking_mode = NORMAL'); // Allows better concurrency

logger.info(`Database schema initialized.`);

const insertPost = db.prepare(`
  INSERT OR IGNORE INTO posts (id, created_at, did, time_us, type, collection, rkey, cursor, embed, reply)
  VALUES (@id, @created_at, @did, @time_us, @type, @collection, @rkey, @cursor, @embed, @reply)
`);

const insertLanguage = db.prepare(`
  INSERT INTO languages (post_id, language)
  VALUES (@post_id, @language)
`);

export function getLastCursor(): number {
  const row = db.prepare(`SELECT last_cursor FROM cursor WHERE id = 1`).get();
  return row ? row.last_cursor : 0;
}

export function updateLastCursor(newCursor: number): void {
  db.prepare(`UPDATE cursor SET last_cursor = @last_cursor WHERE id = 1`).run({ last_cursor: newCursor });
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
  embed?: any; // Optional field
  reply?: any; // Optional field
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
      embed: postData.embed ? JSON.stringify(postData.embed) : null, // Serialize embed
      reply: postData.reply ? JSON.stringify(postData.reply) : null, // Serialize reply
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
    insertOrUpdate(post);
  } catch (error) {
    logger.error(`Database insertion/update error: ${(error as Error).message}`, { post });
  }
}

export function deletePost(postId: string): string[] {
  try {
    const postLangs: string[] = db
      .prepare(`SELECT language FROM languages WHERE post_id = ?`)
      .all(postId)
      .map((row) => row.language);

    const info = db.prepare(`DELETE FROM posts WHERE id = @id`).run({ id: postId });

    if (info.changes > 0) {
      logger.debug(`Hard deleted post ${postId}`);
      return postLangs;
    } else {
      logger.warn(`Attempted to delete non-existent post ${postId}`);
      return [];
    }
  } catch (error) {
    logger.error(`Error deleting post: ${(error as Error).message}`, { postId });
    return [];
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
