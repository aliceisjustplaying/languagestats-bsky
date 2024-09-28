import { CommitCreateEvent, CommitEvent, Jetstream } from '@skyware/jetstream';
import dotenv from 'dotenv';
import process from 'process';

import logger from './logger.js';
import { decrementPostsCount, incrementErrors, incrementMetrics, incrementPostsCount } from './metrics.js';
import { app } from './web.js';

dotenv.config();

const FIREHOSE_URL = process.env.FIREHOSE_URL ?? 'wss://jetstream.atproto.tools/subscribe'; // default to Jaz's Jetstream instance
const PORT = parseInt(process.env.PORT ?? '9201', 10);

function handleCreate(event: CommitCreateEvent<'app.bsky.feed.post'>) {
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
    incrementMetrics(post.langs);
    incrementPostsCount();
  } catch (error) {
    logger.error(`Error parsing record in "create" commit: ${(error as Error).message}`, { commit, record });
    logger.error(`Malformed record data: ${JSON.stringify(record)}`);
    incrementErrors();
  }
}

function handleDelete(event: CommitEvent<'app.bsky.feed.post'>) {
  const { commit } = event;

  if (!commit.rkey) return;

  decrementPostsCount();
}

const server = app.listen(PORT, '127.0.0.1', () => {
  logger.info(`Metrics server listening on port ${PORT}`);
});

const jetstream = new Jetstream({
  wantedCollections: ['app.bsky.feed.post'],
  endpoint: FIREHOSE_URL,
});

jetstream.start();

jetstream.on('open', () => {
  logger.info('Connected to Jetstream firehose.');
});

jetstream.on('close', () => {
  logger.info('Jetstream firehose connection closed.');
});

jetstream.on('error', (error) => {
  logger.error(`Jetstream firehose error: ${error.message}`);
  incrementErrors();
});

jetstream.onCreate('app.bsky.feed.post', (event) => {
  handleCreate(event);
});

jetstream.onDelete('app.bsky.feed.post', (event) => {
  handleDelete(event);
});

function shutdown() {
  logger.info('Shutting down gracefully...');

  server.close(() => {
    logger.info('HTTP server closed.');

    jetstream.close();
    process.exit(0);
  });

  setTimeout(() => {
    logger.error('Forcing shutdown.');
    process.exit(1);
  }, 60000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
