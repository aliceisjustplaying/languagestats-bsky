-- migrations/002-create-emojis-daily.sql

CREATE TABLE IF NOT EXISTS emojis_daily (
    time DATE NOT NULL,
    emoji TEXT NOT NULL,
    count BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (time, emoji)
);

SELECT create_hypertable('emojis_daily', 'time', if_not_exists => TRUE);
