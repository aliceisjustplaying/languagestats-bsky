-- Custom SQL migration file, put you code below! --
CREATE EXTENSION IF NOT EXISTS timescaledb;
SELECT create_hypertable('emoji_usage', by_range('timestamp'));
