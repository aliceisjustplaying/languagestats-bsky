// src/metrics.ts

import { Registry, Gauge, Counter } from 'prom-client';
import logger from './logger';

const register = new Registry();

// Define Metrics
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

export const postsPerSecond = new Gauge({
  name: 'bluesky_posts_per_second',
  help: 'Number of posts processed per second',
  registers: [register],
});

export const errorCounter = new Counter({
  name: 'bluesky_error_count',
  help: 'Total number of errors encountered',
  registers: [register],
});

// New Metric for Unexpected Event Types
export const unexpectedEventCounter = new Counter({
  name: 'bluesky_unexpected_event_count',
  help: 'Total number of unexpected events received',
  labelNames: ['event_type', 'collection'],
  registers: [register],
});

// In-memory storage for language counts
const languageCounts: Record<string, number> = {};

// Function to update metrics
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

// Calculate Posts Per Second
let postsLastInterval = 0;
setInterval(() => {
  postsPerSecond.set(postsLastInterval);
  postsLastInterval = 0;
}, 1000);

// Exported function to increment posts per second
export function incrementPosts(count: number = 1) {
  postsLastInterval += count;
}

// Function to increment error count
export function incrementErrors() {
  errorCounter.inc();
}

// Function to increment unexpected event count
export function incrementUnexpectedEvent(eventType: string, collection: string) {
  unexpectedEventCounter.inc({ event_type: eventType, collection });
}

export { register };
