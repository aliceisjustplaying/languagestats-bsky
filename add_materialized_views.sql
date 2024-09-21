-- Custom SQL migration file, put you code below! --
-- Create Continuous Aggregate for All-time Metrics per Emoji
CREATE MATERIALIZED VIEW IF NOT EXISTS emoji_all_time_stats
WITH (timescaledb.continuous) AS
SELECT
  emoji_id,
  COUNT(*) AS total_count
FROM
  emoji_usage
GROUP BY
  emoji_id;

-- Create Continuous Aggregate for Emoji Usage per Language
CREATE MATERIALIZED VIEW IF NOT EXISTS emoji_language_stats
WITH (timescaledb.continuous) AS
SELECT
  emoji_id,
  language,
  COUNT(*) AS total_count
FROM
  emoji_usage
GROUP BY
  emoji_id, language;

-- Create Continuous Aggregate for Daily Top Emojis per Language
CREATE MATERIALIZED VIEW IF NOT EXISTS emoji_daily_stats
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 day', timestamp) AS day,
  emoji_id,
  language,
  COUNT(*) AS daily_count
FROM
  emoji_usage
GROUP BY
  day, emoji_id, language;
