import type { DictionaryEntry } from '../types/tts';

const ONES = ['', 'یک', 'دو', 'سه', 'چهار', 'پنج', 'شش', 'هفت', 'هشت', 'نه'];
const TEENS = ['ده', 'یازده', 'دوازده', 'سیزده', 'چهارده', 'پانزده', 'شانزده', 'هفده', 'هجده', 'نوزده'];
const TENS = ['', '', 'بیست', 'سی', 'چهل', 'پنجاه', 'شصت', 'هفتاد', 'هشتاد', 'نود'];
const HUNDREDS = ['', 'صد', 'دویست', 'سیصد', 'چهارصد', 'پانصد', 'ششصد', 'هفتصد', 'هشتصد', 'نهصد'];
const SCALES = ['', 'هزار', 'میلیون', 'میلیارد', 'تریلیون'];

export function normalizeDigits(str: string): string {
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

function threeDigitsToWords(n: number): string {
  const parts: string[] = [];
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

export function numberToPersianWords(numStr: string): string {
  const clean = numStr.trim();
  if (/^-?0+$/.test(clean)) return 'صفر';

  const isNegative = clean.startsWith('-');
  const unsigned = isNegative ? clean.slice(1) : clean;

  if (!/^\d+$/.test(unsigned) || unsigned.length > 15) {
    return numStr;
  }

  const chunks: number[] = [];
  let remaining = unsigned;
  while (remaining.length > 0) {
    const chunkLength = remaining.length % 3 || 3;
    chunks.push(parseInt(remaining.slice(0, chunkLength), 10));
    remaining = remaining.slice(chunkLength);
  }

  const numChunks = chunks.length;
  const wordsParts: string[] = [];

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
  if (!result) return 'صفر';
  return isNegative ? `منفی ${result}` : result;
}

export function convertNumbersInText(text: string): string {
  const normalized = normalizeDigits(text);

  return normalized.replace(
    /(?<![0-9/.\-_آ-یa-zA-Z]|\d:)(-?[0-9]{1,12})(?![0-9/.\-_]|:\d)/g,
    (match) => {
      const unsigned = match.startsWith('-') ? match.slice(1) : match;
      if (unsigned.startsWith('0') && unsigned.length > 1) {
        return match;
      }
      if (/^-?0+$/.test(match)) return 'صفر';
      return numberToPersianWords(match);
    }
  );
}

export function normalizePersianChars(text: string): string {
  if (typeof text !== 'string') return '';

  return text
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/ة/g, 'ت')
    .replace(/ۀ/g, 'هٔ')
    .replace(/ـ+/g, '')
    .replace(/\u200E|\u200F|\u202A|\u202B|\u202C/g, '')
    .replace(/\u200c{2,}/g, '\u200c')
    .replace(/(?<![آ-یa-zA-Z0-9\u200c])(ن?می)[ \t]+(?=[آ-ی])/g, '$1\u200c')
    .replace(/(?<=[آ-ی])[ \t]+(ها|های|تر|ترین|ام|ات|اش|ایم|اید|اند)(?![آ-یa-zA-Z0-9\u200c])/g, '\u200c$1')
    // Normalize punctuation spacing WITHOUT corrupting decimals (3.14), times (10:30), or URLs (https://example.com)
    .replace(/[ \t]*([,;؛،؟!?])(?![0-9۰-۹٠-٩])[ \t]*/g, '$1 ')
    .replace(/(?<![0-9۰-۹٠-٩])[ \t]*([.:])(?![0-9۰-۹٠-٩a-zA-Z/])[ \t]*/g, '$1 ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function applyPronunciationDictionary(text: string, dictionary: DictionaryEntry[] = []): string {
  if (!text || !Array.isArray(dictionary) || dictionary.length === 0) {
    return text;
  }

  const sortedDict = [...dictionary]
    .filter((item) => item && item.phrase && item.phrase.trim())
    .sort((a, b) => b.phrase.trim().length - a.phrase.trim().length);

  let processed = text;

  for (const entry of sortedDict) {
    const phrase = entry.phrase.trim();
    const replacement = (entry.replacement || '').trim();
    if (!phrase) continue;

    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(?<![آ-یa-zA-Z0-9\u200c])${escaped}(?![آ-یa-zA-Z0-9\u200c])`, 'gi');
    processed = processed.replace(regex, replacement);
  }

  return processed;
}

export function prepareText(rawText: string, dictionary: DictionaryEntry[] = []): string {
  if (!rawText || typeof rawText !== 'string') return '';

  try {
    let result = normalizePersianChars(rawText);
    result = applyPronunciationDictionary(result, dictionary);
    result = convertNumbersInText(result);
    return result.replace(/[ \t]{2,}/g, ' ').trim();
  } catch (err) {
    console.warn('Text preprocessing warning, using fallback:', err);
    return rawText.trim();
  }
}

export const NARRATOR_NAME = 'راوی';

export function normalizeCharacterName(name: string): string {
  return String(name ?? '')
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/ـ+/g, '')
    .replace(/[\u200E\u200F\u202A-\u202C]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeCharacterName(name: string): boolean {
  if (!name || name.length > 30) return false;
  if (/[0-9۰-۹٠-٩.,!?؟،؛"«»()[\]{}<>/\\]/.test(name)) return false;
  return name.split(' ').length <= 4;
}

export function parseDialogueScript(rawText: string): {
  characters: string[];
  lines: Array<{ character: string; text: string }>;
} {
  if (!rawText || typeof rawText !== 'string') {
    return { characters: [], lines: [] };
  }

  const characters = new Set<string>();
  const lines: Array<{ character: string; text: string }> = [];

  for (const rawLine of rawText.split(/\r\n|\r|\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    if (!/^https?:\/\//i.test(trimmed)) {
      const colonIdx = trimmed.search(/[:：]/);
      if (colonIdx > 0) {
        const name = normalizeCharacterName(trimmed.slice(0, colonIdx));
        const text = trimmed.slice(colonIdx + 1).trim();

        if (looksLikeCharacterName(name) && !text.startsWith('//')) {
          if (!text) continue;
          characters.add(name);
          lines.push({ character: name, text });
          continue;
        }
      }
    }

    characters.add(NARRATOR_NAME);
    lines.push({ character: NARRATOR_NAME, text: trimmed });
  }

  return { characters: Array.from(characters), lines };
}
