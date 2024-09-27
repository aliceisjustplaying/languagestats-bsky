import { CommitCreateEvent, CommitEvent, Jetstream } from '@skyware/jetstream';
import dotenv from 'dotenv';
import process from 'process';

import { closeDatabase, deletePost, getLastCursor, savePost, updateLastCursor } from './db.js';
import logger from './logger.js';
import { decrementPosts, incrementErrors, incrementMetrics, incrementPosts } from './metrics.js';
import { app } from './web.js';

dotenv.config();

const FIREHOSE_URL = process.env.FIREHOSE_URL ?? 'wss://jetstream.atproto.tools/subscribe'; // default to Jaz's Jetstream instance
const PORT = parseInt(process.env.PORT ?? '9201', 10);
const CURSOR_UPDATE_INTERVAL_MS = 10 * 1000;

let latestCursor = await getLastCursor();
logger.info(`Initial cursor set to: ${latestCursor}`);
let cursorUpdateInterval: NodeJS.Timeout | null = null;

function initializeCursorUpdate() {
  cursorUpdateInterval = setInterval(() => {
    if (latestCursor > 0) {
      updateLastCursor(latestCursor)
        .then(() => {
          logger.info(`Cursor updated to ${latestCursor} at ${new Date().toISOString()}`);
        })
        .catch((error: unknown) => {
          logger.error(`Error updating cursor: ${(error as Error).message}`);
        });
    }
  }, CURSOR_UPDATE_INTERVAL_MS);
}

async function handleCreate(event: CommitCreateEvent<'app.bsky.feed.post'>) {
  const { commit } = event;

  if (!commit.rkey) return;

  const { rkey, record } = commit;

  try {
    let langs = new Set<string>();
    if (record.langs) {
      langs = new Set(record.langs.map((lang) => lang.split('-')[0].toLowerCase()));
    } else {
      logger.debug(`"langs" field is missing in record ${JSON.stringify(record)}`);
      langs.add('UNKNOWN');
    }

    const post = {
      id: `${event.did}:${rkey}`,
      created_at: new Date(record.createdAt),
      langs: langs,
      did: event.did,
      rkey: rkey,
      cursor: event.time_us,
    };
    await savePost(post);
    incrementMetrics(post.langs);
    incrementPosts();
    if (event.time_us > latestCursor) {
      latestCursor = event.time_us;
    }
  } catch (error) {
    logger.error(`Error parsing record in "create" commit: ${(error as Error).message}`, { commit, record });
    logger.error(`Malformed record data: ${JSON.stringify(record)}`);
    incrementErrors();
  }
}

async function handleDelete(event: CommitEvent<'app.bsky.feed.post'>) {
  const { commit } = event;

  if (!commit.rkey) return;

  try {
    const postId = `${event.did}:${commit.rkey}`;
    const success = await deletePost(postId);
    if (success) {
      decrementPosts();
    }
    if (event.time_us > latestCursor) {
      latestCursor = event.time_us;
    }
  } catch (error) {
    logger.error(`Error deleting post: ${(error as Error).message}`, { rkey: commit.rkey });
    incrementErrors();
  }
}

const server = app.listen(PORT, '127.0.0.1', () => {
  logger.info(`Metrics server listening on port ${PORT}`);
});

const jetstream = new Jetstream({
  wantedCollections: ['app.bsky.feed.post'],
  endpoint: FIREHOSE_URL,
  cursor: latestCursor.toString(),
});

jetstream.start();

jetstream.on('open', () => {
  logger.info('Connected to Jetstream firehose.');
  if (!cursorUpdateInterval) {
    initializeCursorUpdate();
  }
});

jetstream.on('close', () => {
  logger.info('Jetstream firehose connection closed.');
});

jetstream.on('error', (error) => {
  logger.error(`Jetstream firehose error: ${error.message}`);
  incrementErrors();
});

jetstream.onCreate('app.bsky.feed.post', (event) => {
  void handleCreate(event);
});

jetstream.onDelete('app.bsky.feed.post', (event) => {
  void handleDelete(event);
});

function shutdown() {
  logger.info('Shutting down gracefully...');

  if (cursorUpdateInterval) {
    clearInterval(cursorUpdateInterval);
  }

  server.close(() => {
    logger.info('HTTP server closed.');

    jetstream.close();
    void closeDatabase();
    process.exit(0);
  });

  setTimeout(() => {
    logger.error('Forcing shutdown.');
    process.exit(1);
  }, 60000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
