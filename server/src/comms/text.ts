/**
 * Chat text normalization. The result is stored and relayed as plain text;
 * clients render it as a text node, so HTML in a message is shown literally
 * and never interpreted. This only removes characters that are invisible or
 * that can garble the layout around the message.
 */

// C0/C1 controls, soft hyphen, zero-width chars (except ZWJ, needed by emoji
// sequences), line/paragraph separators, bidi overrides/isolates, BOM.
const INVISIBLE = /[\u0000-\u001F\u007F-\u009F\u00AD\u061C\u180E\u200B\u200C\u200E\u200F\u2028-\u202E\u2060-\u206F\uFEFF\uFFF9-\uFFFB]/g;
// "Zalgo" text: cap stacked combining marks (keycap emoji use 2).
const MARK_STACK = /(\p{M}{3})\p{M}+/gu;

export function sanitizeChatText(raw: string): string {
  return raw.normalize('NFC').replace(INVISIBLE, ' ').replace(MARK_STACK, '$1').replace(/\s+/g, ' ').trim();
}

/** Length in code points, so an emoji counts as one character rather than two UTF-16 units. */
export const textLength = (text: string) => Array.from(text).length;
