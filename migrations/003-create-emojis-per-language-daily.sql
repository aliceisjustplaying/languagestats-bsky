-- migrations/003-create-emojis-per-language-daily.sql

CREATE TABLE IF NOT EXISTS emojis_per_language_daily (
    time DATE NOT NULL,
    language TEXT NOT NULL,
    emoji TEXT NOT NULL,
    count BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (time, language, emoji)
);

SELECT create_hypertable('emojis_per_language_daily', 'time', if_not_exists => TRUE);
