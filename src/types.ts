// src/types.ts

export interface Post {
  id: string;
  created_at: string; // ISO string
  did: string;
  time_us: bigint;
  type: string;
  collection: string;
  rkey: string;
  cursor: bigint;
  is_deleted: boolean;
  embed: any; // JSONB
  reply: any; // JSONB
}

export interface Language {
  post_id: string;
  language: string;
}

export interface Emoji {
  emoji: string;
  count: bigint;
}

export interface EmojiPerLanguage {
  language: string;
  emoji: string;
  count: bigint;
}

export interface EmojiDaily {
  time: string; // YYYY-MM-DD
  emoji: string;
  count: bigint;
}

export interface EmojiPerLanguageDaily {
  time: string; // YYYY-MM-DD
  language: string;
  emoji: string;
  count: bigint;
}
