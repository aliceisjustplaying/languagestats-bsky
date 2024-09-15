-- migrations/004-create-indexes.sql

CREATE INDEX IF NOT EXISTS idx_emojis_daily_emoji_time ON emojis_daily (emoji, time DESC);
CREATE INDEX IF NOT EXISTS idx_emojis_per_language_daily_language_emoji_time ON emojis_per_language_daily (language, emoji, time DESC);
