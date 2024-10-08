import { Counter, Gauge, Registry, collectDefaultMetrics } from 'prom-client';

const register = new Registry();
collectDefaultMetrics({ register });

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

  totalPosts.inc();
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

export function incrementPostsCount(count = 1) {
  postsLastInterval += count;
}

export function decrementPostsCount(count = 1) {
  deletedPostsLastInterval += count;
}

export function incrementErrors() {
  errorCounter.inc();
}

export { register };
