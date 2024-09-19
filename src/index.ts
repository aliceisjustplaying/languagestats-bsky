import WebSocket from 'ws';
import { savePost, softDeletePost, closeDatabase, getLastCursor, updateLastCursor } from './db';
import { updateMetrics, incrementPosts, incrementErrors, incrementUnexpectedEvent, register } from './metrics';
import express from 'express';
import dotenv from 'dotenv';
import process from 'process';
import logger from './logger';

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


// Create WebSocket connection
function constructFirehoseURL(cursor: number = 0): string {
  const url = new URL(FIREHOSE_URL);
  WANTED_COLLECTIONS.forEach((collection) => url.searchParams.append('wantedCollections', collection));
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
      logger.debug(`Cursor updated to ${latestCursor} at ${new Date().toISOString()}`);
    }
  }, CURSOR_UPDATE_INTERVAL_MS);
}

function handleComEvent(event: EventStream) {
  const commit = event.commit;
  if (!commit) {
    logger.warn('Commit field is missing in "com" event', { event });
    incrementUnexpectedEvent('com', 'unknown');
    return;
  }

  const { type: opType, collection, rkey, record } = commit;

  if (collection !== 'app.bsky.feed.post') {
    // Handle other collections if needed
    logger.warn(`Unhandled collection: ${collection}`, { collection });
    incrementUnexpectedEvent('com', collection);
    return;
  }

  if (!rkey) {
    logger.warn('RKey is missing in "com" event commit', { commit });
    incrementUnexpectedEvent('com', collection);
    return;
  }

  switch (opType) {
    case 'c': // Create
      if (!record) {
        logger.warn('Record is missing in "create" commit', { commit });
        incrementUnexpectedEvent('com', collection);
        return;
      }
      try {
        let postRecord;
        if (typeof record === 'string') {
          postRecord = JSON.parse(record);
        } else if (typeof record === 'object') {
          postRecord = record;
        } else {
          throw new Error('Record is neither a string nor an object');
        }

        const postType = postRecord.$type || postRecord.type;
        if (typeof postType !== 'string') {
          throw new Error('Invalid or missing "$type" in record');
        }
        if (typeof postRecord.createdAt !== 'string') {
          throw new Error('Invalid or missing "createdAt" in record');
        }

        let langs: string[] = [];
        if ('langs' in postRecord) {
          if (Array.isArray(postRecord.langs)) {
            langs = postRecord.langs.filter((lang: any) => typeof lang === 'string');
            if (langs.length === 0) {
              logger.warn(`"langs" array is empty or contains no valid strings in record`, { record });
              langs = ['UNKNOWN'];
            }
          } else {
            logger.warn(`"langs" field is not an array in record`, { record });
            langs = ['UNKNOWN'];
          }
        } else {
          logger.warn(`"langs" field is missing in record`, { record });
          langs = ['UNKNOWN'];
        }

        const post = {
          id: `${event.did}:${rkey}`,
          created_at: postRecord.createdAt ?? new Date().toISOString(),
          langs: langs,
          did: event.did ?? 'unknown',
          time_us: typeof event.time_us === 'number' ? event.time_us : Date.now() * 1000,
          type: postType,
          collection: collection ?? 'unknown',
          rkey: rkey,
          cursor: event.time_us,
          embed: postRecord.embed ?? null,
          reply: postRecord.reply ?? null,
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

    case 'u': // Update
      if (!record) {
        logger.warn('Record is missing in "update" commit', { commit });
        incrementUnexpectedEvent('com', collection);
        return;
      }
      try {
        let postRecord;
        if (typeof record === 'string') {
          postRecord = JSON.parse(record);
        } else if (typeof record === 'object') {
          postRecord = record;
        } else {
          throw new Error('Record is neither a string nor an object');
        }

        const postType = postRecord.$type || postRecord.type;
        if (typeof postType !== 'string') {
          throw new Error('Invalid or missing "$type" in record');
        }
        if (typeof postRecord.createdAt !== 'string') {
          throw new Error('Invalid or missing "createdAt" in record');
        }

        let langs: string[] = [];
        if ('langs' in postRecord) {
          if (Array.isArray(postRecord.langs)) {
            langs = postRecord.langs.filter((lang: any) => typeof lang === 'string');
            if (langs.length === 0) {
              logger.warn(`"langs" array is empty or contains no valid strings in record`, { record });
              langs = ['UNKNOWN'];
            }
          } else {
            logger.warn(`"langs" field is not an array in record`, { record });
            langs = ['UNKNOWN'];
          }
        } else {
          logger.warn(`"langs" field is missing in record`, { record });
          langs = ['UNKNOWN'];
        }

        const post = {
          id: `${event.did}:${rkey}`,
          created_at: postRecord.createdAt || new Date().toISOString(),
          langs: langs,
          did: event.did || 'unknown',
          time_us: typeof event.time_us === 'number' ? event.time_us : Date.now() * 1000,
          type: postType,
          collection: collection || 'unknown',
          rkey: rkey,
          cursor: event.time_us,
          embed: postRecord.embed || null,
          reply: postRecord.reply || null,
        };
        savePost(post);
        updateMetrics(post.langs);
        incrementPosts();
        if (event.time_us > latestCursor) {
          latestCursor = event.time_us;
        }
      } catch (error) {
        logger.error(`Error parsing record in "update" commit: ${(error as Error).message}`, { commit, record });
        logger.error(`Malformed record data: ${JSON.stringify(record)}`);
        incrementErrors();
      }
      break;

    case 'd': // Delete
      try {
        const postId = `${event.did}:${rkey}`;
        softDeletePost(postId, event.time_us);
        // Optionally, update metrics or handle language counts
        if (event.time_us > latestCursor) {
          latestCursor = event.time_us;
        }
      } catch (error) {
        logger.error(`Error deleting post: ${(error as Error).message}`, { rkey });
        incrementErrors();
      }
      break;

    default:
      logger.warn(`Unhandled commit type: ${opType}`, { opType });
      incrementUnexpectedEvent('com', collection);
      break;
  }
}

// Function to handle `"acc"` events (optional)
function handleAccEvent(event: any) {
  const account = event.account;
  if (!account) {
    logger.warn('Account field is missing in "acc" event', { event });
    incrementUnexpectedEvent('acc', 'unknown');
    return;
  }

  // Implement account-related logic if needed
  // For example, update account status in the database
  logger.info('Received "acc" event', { account });
}

// Function to handle `"id"` events (optional)
function handleIdEvent(event: any) {
  const identity = event.identity;
  if (!identity) {
    logger.warn('Identity field is missing in "id" event', { event });
    incrementUnexpectedEvent('id', 'unknown');
    return;
  }

  // Implement identity-related logic if needed
  // For example, update user identity information in the database
  logger.info('Received "id" event', { identity });
}

// Function to process incoming events
function processEvent(event: any) {
  const eventType = event.type || 'unknown';
  switch (eventType) {
    case 'com':
      handleComEvent(event);
      break;
    case 'acc':
      handleAccEvent(event);
      break;
    case 'id':
      handleIdEvent(event);
      break;
    default:
      logger.warn(`Unhandled event type: ${eventType}`, { eventType });
      incrementUnexpectedEvent(eventType, 'unknown');
      break;
  }
}

function connect() {
  const url = constructFirehoseURL(latestCursor);
  logger.info(`Connecting to Jetstream at ${url}...`);
  ws = new WebSocket(url);

  ws.on('open', () => {
    logger.info('Connected to Jetstream firehose.');
    reconnectAttempts = 0;
    if (!cursorUpdateInterval) {
      initializeCursorUpdate();
    }
  });

  ws.on('message', (data: WebSocket.Data) => {
    try {
      const event = JSON.parse(data.toString());
      processEvent(event);
    } catch (error) {
      logger.error(`Error processing message: ${(error as Error).message}`);
      incrementErrors();
    }
  });

  ws.on('close', (code, reason) => {
    logger.warn(`WebSocket closed: Code=${code}, Reason=${reason.toString()}`);
    attemptReconnect();
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

app.get('/metrics', async (req, res) => {
  try {
    res.set('Content-Type', register.contentType);
    const metrics = await register.metrics();
    res.send(metrics);
  } catch (ex) {
    logger.error(`Error serving metrics: ${(ex as Error).message}`);
    res.status(500).end(ex.toString());
  }
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
  }, 10000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
