// src/utils.ts
import emojiRegex from 'emoji-regex';

/**
 * Extracts all emojis from a given text string.
 * @param text The text from which to extract emojis.
 * @returns An array of emojis found in the text.
 */
export function extractEmojis(text: string): string[] {
  const regex = emojiRegex();
  const emojis: string[] = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    emojis.push(match[0]);
  }
  return emojis;
}
