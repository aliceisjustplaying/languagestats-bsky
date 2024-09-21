import { count } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Counter, Gauge, Registry } from 'prom-client';

import { db, emojiCache } from './db.js';
import logger from './logger.js';
import { emojiUsage } from './schema.js';

const register = new Registry();

export const languageGauge = new Gauge({
  name: 'bluesky_post_languages',
  help: 'Number of posts per language',
  labelNames: ['language'],
  registers: [register],
});

export const totalPosts = new Counter({
  name: 'bluesky_total_posts',
  help: 'Total number of posts processed',
  registers: [register],
});

export const deletedPosts = new Counter({
  name: 'bluesky_deleted_posts',
  help: 'Number of deleted posts',
  registers: [register],
});

export const postsPerSecond = new Gauge({
  name: 'bluesky_posts_per_second',
  help: 'Number of posts processed per second',
  registers: [register],
});

export const deletedPostsPerSecond = new Gauge({
  name: 'bluesky_deleted_posts_per_second',
  help: 'Number of deleted posts processed per second',
  registers: [register],
});

export const errorCounter = new Counter({
  name: 'bluesky_error_count',
  help: 'Total number of errors encountered',
  registers: [register],
});

export const allTimeEmojiGauge = new Gauge({
  name: 'bluesky_all_time_emojis_total',
  help: 'Total count per emoji all-time',
  labelNames: ['emoji'],
  registers: [register],
});

export const emojiLanguageGauge = new Gauge({
  name: 'bluesky_emojis_by_language_total',
  help: 'Total count per emoji by language',
  labelNames: ['emoji', 'language'],
  registers: [register],
});

export async function updatePrometheusMetrics(db: NodePgDatabase, emojis: Map<string, bigint>) {
  // Update All-Time Emoji Metrics
  const allTimeStats = await db
    .select({ emojiId: emojiUsage.emojiId, count: count() })
    .from(emojiUsage)
    .groupBy(emojiUsage.emojiId);
  allTimeStats.forEach((stat: { emojiId: number | null; count: number }) => {
    const emojiSymbol = Array.from(emojis.entries()).find(([_, id]) => Number(id) === stat.emojiId!)?.[0] ?? 'UNKNOWN';
    allTimeEmojiGauge.set({ emoji: emojiSymbol }, stat.count);
  });

  // Update Emojis by Language
  const languageStats = await db
    .select({ emojiId: emojiUsage.emojiId, language: emojiUsage.language, count: count() })
    .from(emojiUsage)
    .groupBy((t) => [t.emojiId, t.language]);
  languageStats.forEach((stat) => {
    const emojiSymbol = Array.from(emojis.entries()).find(([_, id]) => Number(id) === stat.emojiId!)?.[0] ?? 'UNKNOWN';
    emojiLanguageGauge.set({ emoji: emojiSymbol, language: stat.language! }, stat.count);
  });
}

setInterval(async () => {
  try {
    logger.info(`Updating Prometheus metrics at ${new Date().toISOString()}`);
    const startTime = performance.now();
    await updatePrometheusMetrics(db, emojiCache);
    const endTime = performance.now();
    const duration = endTime - startTime;
    logger.info(`Updating Prometheus metrics took ${duration.toFixed(2)} ms`);
  } catch (err) {
    logger.error(`Error updating Prometheus metrics: ${(err as Error).message}`);
  }
}, 10000); // Update every 60 seconds

const languageCounts: Record<string, number> = {};

export function incrementMetrics(langs: Set<string>) {
  langs.forEach((lang) => {
    if (languageCounts[lang]) {
      languageCounts[lang] += 1;
    } else {
      languageCounts[lang] = 1;
    }
    languageGauge.set({ language: lang }, languageCounts[lang]);
  });

  totalPosts.inc(1);
}

let postsLastInterval = 0;
setInterval(() => {
  postsPerSecond.set(postsLastInterval);
  postsLastInterval = 0;
}, 1000);

let deletedPostsLastInterval = 0;
setInterval(() => {
  deletedPostsPerSecond.set(deletedPostsLastInterval);
  deletedPostsLastInterval = 0;
}, 1000);

export function incrementPosts(count = 1) {
  postsLastInterval += count;
}

export function decrementPosts(count = 1) {
  deletedPostsLastInterval += count;
}

export function incrementErrors() {
  errorCounter.inc();
}

export { register };
