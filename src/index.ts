import dotenv from 'dotenv';
import express from 'express';
import process from 'process';
import WebSocket from 'ws';

import { closeDatabase, deletePost, getLastCursor, savePost, updateLastCursor } from './db';
import logger from './logger';
import {
  decrementMetrics,
  decrementPosts,
  incrementErrors,
  incrementPosts,
  register,
  updateMetrics,
} from './metrics';
import { JetstreamEvent } from './types';

dotenv.config();

const FIREHOSE_URL = process.env.FIREHOSE_URL ?? 'wss://jetstream.atproto.tools/subscribe'; // default to Jaz's Jetstream instance
const PORT = parseInt(process.env.PORT ?? '9201', 10);
const WANTED_COLLECTIONS = process.env.WANTED_COLLECTIONS?.split(',') ?? ['app.bsky.feed.post'];
const RECONNECT_DELAY_MS = 1000;
const CURSOR_UPDATE_INTERVAL_MS = 10 * 1000;

if (!FIREHOSE_URL) {
  logger.error('FIREHOSE_URL is not defined in the environment variables.');
  process.exit(1);
}

function constructFirehoseURL(cursor = 0): string {
  const url = new URL(FIREHOSE_URL);
  WANTED_COLLECTIONS.forEach((collection) => {
    url.searchParams.append('wantedCollections', collection);
  });
  if (cursor > 0) {
    url.searchParams.append('cursor', cursor.toString());
  }
  return url.toString();
}

let ws: WebSocket | null = null;
let reconnectAttempts = 0;
let latestCursor = getLastCursor();
let cursorUpdateInterval: NodeJS.Timeout | null = null;

function initializeCursorUpdate() {
  cursorUpdateInterval = setInterval(() => {
    if (latestCursor > 0) {
      updateLastCursor(latestCursor);
      logger.info(`Cursor updated to ${latestCursor} at ${new Date().toISOString()}`);
    }
  }, CURSOR_UPDATE_INTERVAL_MS);
}

function handleCommitEvent(event: JetstreamEvent) {
  const { commit } = event;

  if (!commit) return;

  if (!commit.collection || !commit.rkey || !commit.record) {
    return;
  }

  const { type, collection, rkey, record } = commit;

  switch (type) {
    case 'c': // Create
      try {
        let langs: string[] = [];
        if (record.langs) {
          langs = record.langs;
        } else {
          logger.debug(`"langs" field is missing in record ${JSON.stringify(record)}`);
          langs = ['UNKNOWN'];
        }

        const post = {
          id: `${event.did}:${rkey}`,
          created_at: record.createdAt,
          langs: langs,
          did: event.did,
          time_us: typeof event.time_us === 'number' ? event.time_us : Date.now() * 1000,
          type: type, // this was previously wrong and stored the collection name. also we don't need it and may drop it
          collection: collection,
          rkey: rkey,
          cursor: event.time_us,
          embed: record.embed ?? null,
          reply: record.reply ?? null,
        };
        savePost(post);
        updateMetrics(post.langs);
        incrementPosts();
        if (event.time_us > latestCursor) {
          latestCursor = event.time_us;
        }
      } catch (error) {
        logger.error(`Error parsing record in "create" commit: ${(error as Error).message}`, { commit, record });
        logger.error(`Malformed record data: ${JSON.stringify(record)}`);
        incrementErrors();
      }
      break;

    case 'd': // Delete
      try {
        const postId = `${event.did}:${rkey}`;
        const langsToDecrement = deletePost(postId);
        decrementMetrics(langsToDecrement);
        decrementPosts();
        if (event.time_us > latestCursor) {
          latestCursor = event.time_us;
        }
      } catch (error) {
        logger.error(`Error deleting post: ${(error as Error).message}`, { rkey });
        incrementErrors();
      }
      break;

    default:
      // there are 'u' update events, but posts don't get updated
      break;
  }
}

function connect() {
  const url = constructFirehoseURL(latestCursor);
  logger.info(`Connecting to Jetstream at ${url}`);
  ws = new WebSocket(url);

  ws.on('open', () => {
    logger.info('Connected to Jetstream firehose.');
    reconnectAttempts = 0;
    if (!cursorUpdateInterval) {
      initializeCursorUpdate();
    }
  });

  ws.on('message', (data: WebSocket.RawData) => {
    try {
      if (data instanceof Buffer) {
        const event: JetstreamEvent = JSON.parse(data.toString()) as JetstreamEvent;
        if (event.type === 'com') {
          handleCommitEvent(event);
        }
      } else {
        logger.error('Received non-buffer data, this should not happen');
      }
    } catch (error) {
      logger.error(`Error processing message: ${(error as Error).message}`);
      incrementErrors();
    }
  });

  ws.on('close', (code, reason) => {
    logger.warn(`WebSocket closed: Code=${code}, Reason=${reason.toString()}`);
    attemptReconnect()
      .then(() => {
        logger.info('Reconnected to Jetstream firehose.');
      })
      .catch((error: unknown) => {
        logger.error(`Error reconnecting to Jetstream firehose: ${(error as Error).message}`);
        incrementErrors();
      });
  });

  ws.on('error', (error) => {
    logger.error(`WebSocket error: ${error.message}`);
    incrementErrors();
    ws?.close();
  });
}

async function attemptReconnect() {
  reconnectAttempts += 1;
  const delay = Math.min(RECONNECT_DELAY_MS * 2 ** reconnectAttempts, 30000); // Up to 30 seconds
  logger.info(`Reconnecting in ${delay / 1000} seconds...`);
  await new Promise((resolve) => setTimeout(resolve, delay));
  connect();
}

connect();

const app = express();

app.get('/metrics', (req, res) => {
  register
    .metrics()
    .then((metrics) => {
      res.set('Content-Type', register.contentType);
      res.send(metrics);
    })
    .catch((ex: unknown) => {
      logger.error(`Error serving metrics: ${(ex as Error).message}`);
      res.status(500).end((ex as Error).message);
    });
});

const server = app.listen(PORT, '127.0.0.1', () => {
  logger.info(`Metrics server listening on port ${PORT}`);
});

function shutdown() {
  logger.info('Shutting down gracefully...');

  if (ws) {
    ws.close();
  }

  if (cursorUpdateInterval) {
    clearInterval(cursorUpdateInterval);
  }

  server.close(() => {
    logger.info('HTTP server closed.');

    closeDatabase();
    process.exit(0);
  });

  setTimeout(() => {
    logger.error('Forcing shutdown.');
    process.exit(1);
  }, 60000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
