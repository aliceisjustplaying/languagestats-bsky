import { Counter, Gauge, Registry } from 'prom-client';

import logger from './logger';

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

export const unexpectedEventCounter = new Counter({
  name: 'bluesky_unexpected_event_count',
  help: 'Total number of unexpected events received',
  labelNames: ['event_type', 'collection'],
  registers: [register],
});

const languageCounts: Record<string, number> = {};

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

  totalPosts.inc(1);
}

let postsLastInterval = 0;
setInterval(() => {
  postsPerSecond.set(postsLastInterval);
  postsLastInterval = 0;
}, 1000);

export function incrementPosts(count = 1) {
  postsLastInterval += count;
}

export function decrementPosts(count = 1) {
  postsLastInterval -= count;
}

export function incrementErrors() {
  errorCounter.inc();
}

export function incrementUnexpectedEvent(eventType: string, collection: string) {
  unexpectedEventCounter.inc({ event_type: eventType, collection });
}

export function decrementMetrics(langs: string[]) {
  langs.forEach((lang) => {
    if (languageCounts[lang]) {
      languageCounts[lang] -= 1;
      if (languageCounts[lang] <= 0) {
        delete languageCounts.lang;
        languageGauge.remove({ language: lang });
      } else {
        languageGauge.set({ language: lang }, languageCounts[lang]);
      }
    } else {
      logger.warn(`Language count for "${lang}" is already zero or does not exist`);
    }
  });
}
export { register };
