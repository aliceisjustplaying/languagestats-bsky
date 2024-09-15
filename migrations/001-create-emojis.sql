-- migrations/001-create-emojis.sql

CREATE TABLE IF NOT EXISTS emojis (
    emoji TEXT PRIMARY KEY,
    count BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS emojis_per_language (
    language TEXT NOT NULL,
    emoji TEXT NOT NULL,
    count BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (language, emoji),
    FOREIGN KEY (emoji) REFERENCES emojis(emoji) ON DELETE CASCADE
);
