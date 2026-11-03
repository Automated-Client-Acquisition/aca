/**
 * OOO Date Parser (Node.js port)
 */

const MONTH_MAP: Record<string, number> = {
  january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2,
  april: 3, apr: 3, may: 4, june: 5, jun: 5, july: 6, jul: 6,
  august: 7, aug: 7, september: 8, sep: 8, sept: 8,
  october: 9, oct: 9, november: 10, nov: 10, december: 11, dec: 11,
};

const DAY_MAP: Record<string, number> = {
  sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3, thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5, saturday: 6, sat: 6,
};

export function parseOOOReturnDate(emailBody: string): Date | null {
  if (!emailBody || typeof emailBody !== 'string') return null;
  const normalized = emailBody.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
  const dateStr = matchReturnDateString(normalized);
  if (!dateStr) return null;
  const parsed = parseDateString(dateStr.trim());
  if (!parsed) return null;
  const oneDayAgo = new Date();
  oneDayAgo.setDate(oneDayAgo.getDate() - 1);
  oneDayAgo.setHours(0, 0, 0, 0);
  if (parsed < oneDayAgo) return null;
  return parsed;
}

function matchReturnDateString(text: string): string | null {
  const patterns: RegExp[] = [
    /(?:until|through)\s+(.+?)(?:\.|;|\s+and\s|\s+but\s|\s+I\b|\s+if\b|$)/i,
    /(?:back|return|returning)\s+(?:to\s+(?:the\s+)?office\s+)?on\s+(.+?)(?:\.|;|\s+and\s|\s+but\s|\s+I\b|\s+if\b|$)/i,
    /back\s+in\s+the\s+office\s+on\s+(.+?)(?:\.|;|\s+and\s|\s+but\s|\s+I\b|\s+if\b|$)/i,
    /available\s+(?:again|starting)\s+(.+?)(?:\.|;|\s+and\s|\s+but\s|\s+I\b|\s+if\b|$)/i,
    /(?:will\s+be|I'?ll\s+be)\s+back\s+(.+?)(?:\.|;|\s+and\s|\s+but\s|\s+I\b|\s+if\b|$)/i,
    /out\s+(?:of\s+(?:the\s+)?office\s+)?until\s+(.+?)(?:\.|;|\s+and\s|\s+but\s|\s+I\b|\s+if\b|$)/i,
    /returning\s+(.+?)(?:\.|;|\s+and\s|\s+but\s|\s+I\b|\s+if\b|$)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1] && match[1].trim().length <= 40) return match[1];
  }
  return null;
}

function parseDateString(str: string): Date | null {
  const lower = str.toLowerCase().trim().replace(/[,\s]+$/, '');
  if (/^tomorrow\b/.test(lower)) {
    const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d;
  }
  const withoutWeekday = lower.replace(
    /^(?:next\s+)?(?:sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?)\s*,?\s+/,
    '',
  );
  if (withoutWeekday !== lower) {
    const explicit = parseNamedMonth(withoutWeekday) || parseNumericDate(withoutWeekday);
    if (explicit) return explicit;
  }
  const named = parseNamedMonth(lower);
  if (named) return named;
  const numeric = parseNumericDate(lower);
  if (numeric) return numeric;
  return parseDayOfWeek(lower);
}

function parseDayOfWeek(str: string): Date | null {
  const isNext = /^next\s+/.test(str);
  const cleaned = str.replace(/^next\s+/, '');
  for (const [name, targetDay] of Object.entries(DAY_MAP)) {
    if (cleaned === name || cleaned.startsWith(name + ' ')) {
      const today = new Date();
      let daysUntil = targetDay - today.getDay();
      if (isNext) { if (daysUntil <= 0) daysUntil += 7; if (daysUntil === 0) daysUntil = 7; }
      else { if (daysUntil <= 0) daysUntil += 7; }
      const result = new Date();
      result.setDate(today.getDate() + daysUntil);
      result.setHours(9, 0, 0, 0);
      return result;
    }
  }
  return null;
}

function parseNamedMonth(str: string): Date | null {
  const m1 = str.match(/^(\w+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*,?\s*(\d{4}))?/);
  if (m1) {
    const month = MONTH_MAP[m1[1].toLowerCase()];
    if (month !== undefined) {
      const day = parseInt(m1[2], 10);
      const year = m1[3] ? parseInt(m1[3], 10) : inferYear(month, day);
      return buildDate(year, month, day);
    }
  }
  const m2 = str.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+(\w+)(?:\s*,?\s*(\d{4}))?/);
  if (m2) {
    const month = MONTH_MAP[m2[2].toLowerCase()];
    if (month !== undefined) {
      const day = parseInt(m2[1], 10);
      const year = m2[3] ? parseInt(m2[3], 10) : inferYear(month, day);
      return buildDate(year, month, day);
    }
  }
  return null;
}

function parseNumericDate(str: string): Date | null {
  const m = str.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?/);
  if (!m) return null;
  const first = parseInt(m[1], 10);
  const second = parseInt(m[2], 10);
  const dayFirst = first > 12 && second <= 12;
  const month = (dayFirst ? second : first) - 1;
  const day = dayFirst ? first : second;
  let year = m[3] ? parseInt(m[3], 10) : 0;
  if (year > 0 && year < 100) year += 2000;
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;
  if (!year) year = inferYear(month, day);
  return buildDate(year, month, day);
}

function inferYear(month: number, day: number): number {
  const now = new Date();
  const thisYear = now.getFullYear();
  const candidate = new Date(thisYear, month, day);
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1); yesterday.setHours(0, 0, 0, 0);
  return candidate < yesterday ? thisYear + 1 : thisYear;
}

function buildDate(year: number, month: number, day: number): Date | null {
  if (month < 0 || month > 11 || day < 1 || day > 31 || year < 2020 || year > 2100) return null;
  const d = new Date(year, month, day, 9, 0, 0, 0);
  if (d.getMonth() !== month || d.getDate() !== day) return null;
  return d;
}
