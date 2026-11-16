/**
 * Persian Text Preprocessing, Number-to-Words Normalizer, Dialogue Parser & SRT Generator
 * Handles character unification, ZWNJ/spacing corrections, dictionary replacements,
 * robust conversion of standard cardinal numbers to Persian words,
 * dialogue/screenplay parsing, and SRT subtitle generation.
 */

const ONES = ['', 'یک', 'دو', 'سه', 'چهار', 'پنج', 'شش', 'هفت', 'هشت', 'نه'];
const TEENS = ['ده', 'یازده', 'دوازده', 'سیزده', 'چهارده', 'پانزده', 'شانزده', 'هفده', 'هجده', 'نوزده'];
const TENS = ['', '', 'بیست', 'سی', 'چهل', 'پنجاه', 'شصت', 'هفتاد', 'هشتاد', 'نود'];
const HUNDREDS = ['', 'صد', 'دویست', 'سیصد', 'چهارصد', 'پانصد', 'ششصد', 'هفتصد', 'هشتصد', 'نهصد'];
const SCALES = ['', 'هزار', 'میلیون', 'میلیارد', 'تریلیون'];

/**
 * Convert standard Persian / Arabic digits to English digits for processing.
 */
export function normalizeDigits(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/[۰٠]/g, '0')
    .replace(/[۱١]/g, '1')
    .replace(/[۲٢]/g, '2')
    .replace(/[۳٣]/g, '3')
    .replace(/[۴٤]/g, '4')
    .replace(/[۵٥]/g, '5')
    .replace(/[۶٦]/g, '6')
    .replace(/[۷٧]/g, '7')
    .replace(/[۸٨]/g, '8')
    .replace(/[۹٩]/g, '9');
}

/**
 * Convert an integer (up to 999,999,999,999) to Persian words.
 */
function threeDigitsToWords(n) {
  const parts = [];
  const h = Math.floor(n / 100);
  const rem = n % 100;
  const t = Math.floor(rem / 10);
  const o = rem % 10;

  if (h > 0) parts.push(HUNDREDS[h]);

  if (rem >= 10 && rem <= 19) {
    parts.push(TEENS[rem - 10]);
  } else {
    if (t > 0) parts.push(TENS[t]);
    if (o > 0) parts.push(ONES[o]);
  }

  return parts.filter(Boolean).join(' و ');
}

export function numberToPersianWords(numStr) {
  const clean = numStr.trim();
  if (clean === '0') return 'صفر';

  const isNegative = clean.startsWith('-');
  const unsigned = isNegative ? clean.slice(1) : clean;

  if (!/^\d+$/.test(unsigned) || unsigned.length > 15) {
    return numStr; // Return as-is if exceeds standard range or non-integer
  }

  const chunks = [];
  let remaining = unsigned;
  while (remaining.length > 0) {
    const chunkLength = remaining.length % 3 || 3;
    chunks.push(parseInt(remaining.slice(0, chunkLength), 10));
    remaining = remaining.slice(chunkLength);
  }

  const numChunks = chunks.length;
  const wordsParts = [];

  for (let i = 0; i < numChunks; i++) {
    const val = chunks[i];
    const scaleIndex = numChunks - 1 - i;
    if (val > 0) {
      const chunkWords = threeDigitsToWords(val);
      const scale = SCALES[scaleIndex];
      wordsParts.push(scale ? `${chunkWords} ${scale}` : chunkWords);
    }
  }

  const result = wordsParts.join(' و ');
  return isNegative ? `منفی ${result}` : result;
}

/**
 * Replace standalone numbers with Persian words.
 * Explicit boundary: Excludes dates (1402/08/10), phones (0912...), codes, decimals.
 */
export function convertNumbersInText(text) {
  const normalized = normalizeDigits(text);

  // Match standalone integers not surrounded by slashes, dashes, or phone prefixes
  return normalized.replace(/(?<![0-9/.\-_])([0-9]{1,12})(?![0-9/.\-_])/g, (match) => {
    // Check if it looks like a phone number (e.g. starts with 0 and length > 7)
    if (match.startsWith('0') && match.length > 1) {
      return match; // Leave phone numbers or codes untouched
    }
    return numberToPersianWords(match);
  });
}

/**
 * Persian Character & Spacing Normalization
 */
export function normalizePersianChars(text) {
  if (typeof text !== 'string') return '';

  return text
    // Normalize Arabic Yeh and Kaf
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    // Normalize Heh with Yeh
    .replace(/ة/g, 'ت')
    .replace(/ۀ/g, 'هٔ')
    // Remove tatweel (kashida)
    .replace(/ـ+/g, '')
    // Normalize ZWNJ (Zero-Width Non-Joiner)
    .replace(/\u200E|\u200F|\u202A|\u202B|\u202C/g, '')
    .replace(/\u200c{2,}/g, '\u200c')
    // Common Persian prefixes: می and نمی
    .replace(/\b(ن?می)\s+/g, '$1\u200c')
    // Common Persian suffixes: ها، های، تر، ترین
    .replace(/\s+(ها|های|تر|ترین|ام|ات|اش|ایم|اید|اند)\b/g, '\u200c$1')
    // Fix spacing around punctuation marks
    .replace(/\s*([.,!?;:؛،؟])\s*/g, '$1 ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Apply Pronunciation Dictionary Replacements
 * Avoids accidental substring matching using Persian word boundaries.
 * Sorts dictionary by phrase length descending to prioritize longer phrases.
 */
export function applyPronunciationDictionary(text, dictionary = []) {
  if (!text || !Array.isArray(dictionary) || dictionary.length === 0) {
    return text;
  }

  // Sort descending by phrase length to ensure longest matching first
  const sortedDict = [...dictionary]
    .filter(item => item && item.phrase && item.phrase.trim())
    .sort((a, b) => b.phrase.trim().length - a.phrase.trim().length);

  let processed = text;

  for (const entry of sortedDict) {
    const phrase = entry.phrase.trim();
    const replacement = (entry.replacement || '').trim();
    if (!phrase) continue;

    // Persian word boundary regex: ensure not preceded or followed by Persian/Latin letters or digits
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(?<![آ-یa-zA-Z0-9\u200c])${escaped}(?![آ-یa-zA-Z0-9\u200c])`, 'g');
    processed = processed.replace(regex, replacement);
  }

  return processed;
}

/**
 * Complete Persian Text Preparation Pipeline
 * Produces the exact string that is previewed to the user and sent to the TTS API.
 * Never throws; on error, returns safely normalized original text.
 */
export function prepareText(rawText, dictionary = []) {
  if (!rawText || typeof rawText !== 'string') return '';

  try {
    // 1. Character normalization and spacing
    let result = normalizePersianChars(rawText);

    // 2. Pronunciation dictionary replacements
    result = applyPronunciationDictionary(result, dictionary);

    // 3. Number to Persian words expansion
    result = convertNumbersInText(result);

    // Final space trimming
    return result.replace(/\s{2,}/g, ' ').trim();
  } catch (err) {
    console.warn('Text preprocessing warning, using fallback:', err);
    return rawText.trim();
  }
}

// ==============================================================
// DIALOGUE / SCREENPLAY PARSER
// ==============================================================

export const NARRATOR_NAME = 'راوی';

/**
 * Canonical character name: unify Arabic yeh/kaf, drop bidi marks, collapse spaces.
 * Keeps the mapping key stable ("علي" and "علی" are the same character).
 */
export function normalizeCharacterName(name) {
  return String(name ?? '')
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[\u200E\u200F\u202A-\u202C]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A "name" before the colon must look like a name, not like a sentence:
 * no digits / sentence punctuation (e.g. "ساعت ۸:۳۰ شد" or "نکته: ..."), max 4 words.
 */
function looksLikeCharacterName(name) {
  if (!name || name.length > 30) return false;
  if (/[0-9۰-۹٠-٩.,!?؟،؛"«»()\[\]{}<>\/\\]/.test(name)) return false;
  return name.split(' ').length <= 4;
}

/**
 * Parse a screenplay/dialogue text into structured lines.
 * "علی: سلام" / "سارا : خوبی؟" → one turn per line (regular or full-width colon).
 * Lines that are not a valid "name: text" turn are narrator lines ("راوی").
 * A "name:" line with no text is ignored.
 *
 * @param {string} rawText
 * @returns {{ characters: string[], lines: Array<{character: string, text: string}> }}
 */
export function parseDialogueScript(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    return { characters: [], lines: [] };
  }

  const characters = new Set();
  const lines = [];

  for (const rawLine of rawText.split(/\r\n|\r|\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    const colonIdx = trimmed.search(/[:：]/);
    if (colonIdx > 0) {
      const name = normalizeCharacterName(trimmed.slice(0, colonIdx));
      const text = trimmed.slice(colonIdx + 1).trim();

      if (looksLikeCharacterName(name)) {
        if (!text) continue; // "علی:" without any speech
        characters.add(name);
        lines.push({ character: name, text });
        continue;
      }
    }

    // Non-dialogue line → narrator
    characters.add(NARRATOR_NAME);
    lines.push({ character: NARRATOR_NAME, text: trimmed });
  }

  return { characters: Array.from(characters), lines };
}

// ==============================================================
// SRT SUBTITLE GENERATOR
// ==============================================================

/**
 * Format milliseconds as SRT timestamp: HH:MM:SS,mmm
 */
function formatSrtTime(totalMs) {
  const msAll = Math.max(0, Math.round(totalMs));
  const ms = msAll % 1000;
  const totalSec = Math.floor(msAll / 1000);
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60) % 60;
  const h = Math.floor(totalSec / 3600);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

/**
 * Generate SRT content from finalAudio.clipSnapshots (same order/pauses as the merge request).
 *
 * Timeline (all in integer ms, so no float drift):
 *   start(i) = Σ_{k<i} ( duration(k) + pauseAfter(k) )
 *   end(i)   = start(i) + duration(i)
 * The pause only moves the NEXT subtitle; it is never part of a subtitle's text or span.
 * The last clip's pause is ignored (the merge uses 0 after the last clip).
 * Subtitle text is the clip's original `text` (not the number-expanded preparedText).
 *
 * @param {Array<{text: string, preparedText?: string, durationSec: number, pauseAfterMs: number}>} clipSnapshots
 * @returns {string} SRT content ('' if nothing can be generated)
 */
export function generateSrtContent(clipSnapshots) {
  if (!Array.isArray(clipSnapshots) || clipSnapshots.length === 0) return '';

  let cursorMs = 0;
  let counter = 0;
  const entries = [];

  clipSnapshots.forEach((snap, i) => {
    const durationMs = typeof snap.durationSec === 'number' && snap.durationSec > 0
      ? Math.round(snap.durationSec * 1000)
      : 0;
    const isLast = i === clipSnapshots.length - 1;
    const pauseMs = !isLast && typeof snap.pauseAfterMs === 'number' && snap.pauseAfterMs > 0
      ? Math.round(snap.pauseAfterMs)
      : 0;

    const startMs = cursorMs;
    const endMs = startMs + durationMs;

    // A blank line would terminate the SRT cue → drop empty lines inside the text
    const subtitleText = String(snap.text || snap.preparedText || '')
      .split(/\r\n|\r|\n/)
      .map(l => l.trim())
      .filter(Boolean)
      .join('\n');

    if (subtitleText && durationMs > 0) {
      counter += 1;
      entries.push(`${counter}\n${formatSrtTime(startMs)} --> ${formatSrtTime(endMs)}\n${subtitleText}`);
    }

    cursorMs = endMs + pauseMs;
  });

  return entries.length > 0 ? entries.join('\n\n') + '\n' : '';
}
