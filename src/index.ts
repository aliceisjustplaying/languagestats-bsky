// src/index.ts
// Assuming you have a logger setup
import dotenv from 'dotenv';
import express from 'express';
// Metrics setup
import { RateLimiterMemory } from 'rate-limiter-flexible';
import WebSocket from 'ws';

import { closeDatabase, getLastCursor, incrementEmojiData, savePost, softDeletePost, updateLastCursor } from './db';
import logger from './logger';
// Utility function to extract emojis
import {
  incrementEmojiPerLanguage,
  incrementEmojiTotal,
  incrementErrors,
  incrementPosts,
  incrementUnexpectedEvent,
  register,
  updateMetrics,
} from './metrics';
import { Post } from './types';
import { extractEmojis } from './utils';

dotenv.config();

// Configuration
const FIREHOSE_URL = process.env.FIREHOSE_URL ?? 'ws://localhost:8080'; // Replace with actual URL
const PORT = parseInt(process.env.PORT ?? '3000', 10);
const WANTED_COLLECTIONS =
  process.env.WANTED_COLLECTIONS ? process.env.WANTED_COLLECTIONS.split(',') : ['app.bsky.feed.post'];
const RECONNECT_DELAY_MS = 1000; // Initial reconnect delay in ms
const CURSOR_UPDATE_INTERVAL_MS = 10 * 1000; // 10 seconds

// Validate Environment Variables
if (!FIREHOSE_URL) {
  logger.error('FIREHOSE_URL is not defined in the environment variables.');
  process.exit(1);
}

// Initialize Rate Limiter for Unexpected Events
const unexpectedEventRateLimiter = new RateLimiterMemory({
  points: 100, // 100 points
  duration: 60, // Per 60 seconds
});

// Function to log unexpected events with rate limiting
function logUnexpectedEvent(eventType: string, collection: string, eventId: string, did: string, rawEvent?: any) {
  unexpectedEventRateLimiter
    .consume('unexpectedEvent')
    .then(() => {
      logger.warn(
        {
          message: 'Received unexpected event structure',
          eventType,
          collection,
          eventId,
          did,
          rawEvent,
        },
        'Received unexpected event structure',
      );
    })
    .catch(() => {
      // Rate limit exceeded: do not log
    });
}

// Create WebSocket connection
function constructFirehoseURL(cursor = BigInt(0)): string {
  const url = new URL(FIREHOSE_URL);
  WANTED_COLLECTIONS.forEach((collection) => {
    url.searchParams.append('wantedCollections', collection);
  });
  if (cursor > BigInt(0)) {
    url.searchParams.append('cursor', cursor.toString());
  }
  return url.toString();
}

let ws: WebSocket | null = null;
let reconnectAttempts = 0;
let latestCursor = BigInt(0);
let cursorUpdateInterval: NodeJS.Timeout | null = null;

// Function to initialize cursor update interval
function initializeCursorUpdate() {
  cursorUpdateInterval = setInterval(async () => {
    if (latestCursor > BigInt(0)) {
      await updateLastCursor(latestCursor);
      logger.debug(`Cursor updated to ${latestCursor.toString()} at ${new Date().toISOString()}`);
    }
  }, CURSOR_UPDATE_INTERVAL_MS);
}

// Function to handle "com" events
async function handleComEvent(event: any) {
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
    case 'u': // Update
      if (!record) {
        logger.warn(`Record is missing in "${opType}" commit`, { commit });
        incrementUnexpectedEvent('com', collection);
        return;
      }
      try {
        // Parse the record
        let postRecord;
        if (typeof record === 'string') {
          postRecord = JSON.parse(record);
        } else if (typeof record === 'object') {
          postRecord = record;
        } else {
          throw new Error('Record is neither a string nor an object');
        }

        // Validate postRecord fields
        const postType = postRecord.$type || postRecord.type;
        if (typeof postType !== 'string') {
          throw new Error('Invalid or missing "$type" in record');
        }
        if (typeof postRecord.createdAt !== 'string') {
          throw new Error('Invalid or missing "createdAt" in record');
        }

        // Handle "langs" field
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

        // Extract post content from 'embed' field
        let postContent = '';
        if (postRecord.embed && typeof postRecord.embed === 'object') {
          // Adjust the path based on the actual structure of 'embed'
          // Assuming 'text' field contains the post content
          postContent = postRecord.embed.text || '';
        }

        const emojis = extractEmojis(postContent);

        const post: Post = {
          id: `${event.did}:${rkey}`,
          created_at: new Date(postRecord.createdAt).toISOString(),
          did: event.did || 'unknown',
          time_us: typeof event.time_us === 'number' ? BigInt(event.time_us) : BigInt(Date.now()) * BigInt(1000),
          type: postType, // Assign the correct type
          collection: collection || 'unknown',
          rkey: rkey,
          cursor: typeof event.time_us === 'number' ? BigInt(event.time_us) : BigInt(Date.now()) * BigInt(1000),
          is_deleted: postRecord.is_deleted || false,
          embed: postRecord.embed || null, // Handle optional embed
          reply: postRecord.reply || null, // Handle optional reply
        };

        // Save post and languages
        await savePost(
          post,
          langs.map((lang) => ({ post_id: post.id, language: lang })),
        );

        // Update metrics
        updateMetrics(langs);
        incrementPosts();

        // Update latest cursor
        const eventCursor =
          typeof event.time_us === 'number' ? BigInt(event.time_us) : BigInt(Date.now()) * BigInt(1000);
        if (eventCursor > latestCursor) {
          latestCursor = eventCursor;
        }

        // Update Emoji Statistics
        const currentDate = getCurrentDate();
        for (const emoji of emojis) {
          for (const lang of langs) {
            await incrementEmojiData(emoji, lang, currentDate);
            incrementEmojiPerLanguage(emoji, lang);
          }
          // Update Prometheus metrics
          incrementEmojiTotal(emoji);
        }
      } catch (error) {
        logger.error(`Error parsing record in "${opType}" commit: ${(error as Error).message}`, { commit, record });
        // Log the entire record for debugging
        logger.error(`Malformed record data: ${JSON.stringify(record)}`);
        incrementErrors();
      }
      break;

    case 'd': // Delete
      try {
        const postId = `${event.did}:${rkey}`;
        await softDeletePost(
          postId,
          typeof event.time_us === 'number' ? BigInt(event.time_us) : BigInt(Date.now()) * BigInt(1000),
        );
        // Optionally, update metrics or handle language counts
        const eventCursor =
          typeof event.time_us === 'number' ? BigInt(event.time_us) : BigInt(Date.now()) * BigInt(1000);
        if (eventCursor > latestCursor) {
          latestCursor = eventCursor;
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

// Function to connect to Jetstream Firehose
function connect() {
  const url = constructFirehoseURL(latestCursor);
  logger.info(`Connecting to Jetstream at ${url}...`);
  ws = new WebSocket(url);

  ws.on('open', () => {
    logger.info('Connected to Jetstream firehose.');
    reconnectAttempts = 0;
    // Initialize cursor update interval upon successful connection
    if (!cursorUpdateInterval) {
      initializeCursorUpdate();
    }
  });

  ws.on('message', async (data: WebSocket.Data) => {
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

// Reconnection logic with exponential backoff
async function attemptReconnect() {
  reconnectAttempts += 1;
  const delay = Math.min(RECONNECT_DELAY_MS * 2 ** reconnectAttempts, 30000); // Up to 30 seconds
  logger.info(`Reconnecting in ${delay / 1000} seconds...`);
  await new Promise((resolve) => setTimeout(resolve, delay));
  connect();
}

// Initialize and connect
(async () => {
  try {
    latestCursor = await getLastCursor();
    connect();
  } catch (error) {
    logger.error(`Error during initialization: ${(error as Error).message}`);
    process.exit(1);
  }
})();

// Set up Express server for Prometheus metrics
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

const server = app.listen(PORT, '0.0.0.0', () => {
  logger.info(`Metrics server listening on port ${PORT}`);
});

// Graceful Shutdown
function shutdown() {
  logger.info('Shutting down gracefully...');
  if (ws) {
    ws.close();
  }
  if (cursorUpdateInterval) {
    clearInterval(cursorUpdateInterval);
  }
  server.close(async () => {
    logger.info('HTTP server closed.');
    try {
      await closeDatabase();
      process.exit(0);
    } catch (error) {
      logger.error(`Error during shutdown: ${(error as Error).message}`);
      process.exit(1);
    }
  });

  // Force shutdown after 10 seconds
  setTimeout(() => {
    logger.error('Forcing shutdown.');
    process.exit(1);
  }, 10000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
