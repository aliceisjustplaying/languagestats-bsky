// src/metrics.ts
import { Counter, Gauge, Registry } from 'prom-client';

import logger from './logger';

// Initialize Prometheus registry
const register = new Registry();

// Define Metrics

// --- Existing Metrics ---

// Gauge for tracking the number of posts per language
export const languageGauge = new Gauge({
  name: 'bluesky_post_languages',
  help: 'Number of posts per language',
  labelNames: ['language'],
  registers: [register],
});

// Counter for the total number of posts processed
export const totalPosts = new Counter({
  name: 'bluesky_total_posts',
  help: 'Total number of posts processed',
  registers: [register],
});

// Gauge for tracking the number of posts processed per second
export const postsPerSecond = new Gauge({
  name: 'bluesky_posts_per_second',
  help: 'Number of posts processed per second',
  registers: [register],
});

// Counter for tracking the total number of errors encountered
export const errorCounter = new Counter({
  name: 'bluesky_error_count',
  help: 'Total number of errors encountered',
  registers: [register],
});

// Counter for tracking unexpected events received
export const unexpectedEventCounter = new Counter({
  name: 'bluesky_unexpected_event_count',
  help: 'Total number of unexpected events received',
  labelNames: ['event_type', 'collection'],
  registers: [register],
});

// --- New Metrics for Emoji Statistics ---

// Counter for the total number of times each emoji has been used
export const emojiTotalCounter = new Counter({
  name: 'bluesky_emoji_total',
  help: 'Total number of times each emoji has been used',
  labelNames: ['emoji'],
  registers: [register],
});

// Counter for the total number of times each emoji has been used per language
export const emojiPerLanguageCounter = new Counter({
  name: 'bluesky_emoji_per_language_total',
  help: 'Total number of times each emoji has been used per language',
  labelNames: ['emoji', 'language'],
  registers: [register],
});

// --- Helper Functions ---

// In-memory storage for language counts
const languageCounts: Record<string, number> = {};

/**
 * Updates language metrics based on the languages associated with a post.
 * @param langs Array of language codes.
 */
export function updateMetrics(langs: string[]) {
  langs.forEach((lang) => {
    if (typeof lang !== 'string') {
      logger.warn(`Invalid language type encountered: ${typeof lang}`, { lang });
      return;
    }
    if (languageCounts[lang]) {
      languageCounts[lang] += 1;
    } else {
      languageCounts[lang] = 1;
    }
    languageGauge.set({ language: lang }, languageCounts[lang]);
  });

  // Increment totalPosts by 1 per post
  totalPosts.inc(1);
}

// Variables and functions to calculate posts per second
let postsLastInterval = 0;

/**
 * Sets up an interval to calculate and update posts per second.
 */
setInterval(() => {
  postsPerSecond.set(postsLastInterval);
  postsLastInterval = 0;
}, 1000);

/**
 * Increments the posts processed counter.
 * @param count Number of posts to increment by (default is 1).
 */
export function incrementPosts(count = 1) {
  postsLastInterval += count;
}

/**
 * Increments the error counter by one.
 */
export function incrementErrors() {
  errorCounter.inc();
}

/**
 * Increments the unexpected event counter with specific labels.
 * @param eventType Type of the unexpected event.
 * @param collection Collection associated with the event.
 */
export function incrementUnexpectedEvent(eventType: string, collection: string) {
  unexpectedEventCounter.inc({ event_type: eventType, collection });
}

/**
 * Increments the total emoji usage counter for a specific emoji.
 * @param emoji The emoji character.
 */
export function incrementEmojiTotal(emoji: string) {
  emojiTotalCounter.inc({ emoji }, 1);
}

/**
 * Increments the per-language emoji usage counter for a specific emoji and language.
 * @param emoji The emoji character.
 * @param language The language code.
 */
export function incrementEmojiPerLanguage(emoji: string, language: string) {
  emojiPerLanguageCounter.inc({ emoji, language }, 1);
}

export { register };
