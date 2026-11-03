/**
 * OOO Date Parser Module (shared)
 *
 * Parses Out-of-Office (OOO) return dates from email body text.
 * Uses regex pattern matching with manual date parsing — no external
 * date libraries required.
 *
 * Used by:
 *   - conversation-autopilot.ts (smart snooze on auto_followup_after_return)
 *   - email-imap-poller (OOO scheduling)
 */

// ============================================================================
// Types
// ============================================================================

/** Month name/abbreviation → 0-indexed month number */
const MONTH_MAP: Record<string, number> = {
  january: 0, jan: 0,
  february: 1, feb: 1,
  march: 2, mar: 2,
  april: 3, apr: 3,
  may: 4,
  june: 5, jun: 5,
  july: 6, jul: 6,
  august: 7, aug: 7,
  september: 8, sep: 8, sept: 8,
  october: 9, oct: 9,
  november: 10, nov: 10,
  december: 11, dec: 11,
};

/** Day name → 0-indexed day of week (Sunday = 0) */
const DAY_MAP: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

// ============================================================================
// Main Export
// ============================================================================

/**
 * Parse an OOO return date from email body text.
 * Returns null if no date found or if the parsed date is in the past (> 1 day ago).
 */
export function parseOOOReturnDate(emailBody: string): Date | null {
  if (!emailBody || typeof emailBody !== 'string') return null;

  // Normalize whitespace — collapse newlines and multiple spaces
  const normalized = emailBody.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();

  // Try each pattern group in priority order
  const dateStr = matchReturnDateString(normalized);
  if (!dateStr) return null;

  const parsed = parseDateString(dateStr.trim());
  if (!parsed) return null;

  // Reject dates more than 1 day in the past
  const oneDayAgo = new Date();
  oneDayAgo.setDate(oneDayAgo.getDate() - 1);
  oneDayAgo.setHours(0, 0, 0, 0);

  if (parsed < oneDayAgo) return null;

  return parsed;
}

// ============================================================================
// Pattern Matching
// ============================================================================

/**
 * Attempt to extract a date string from common OOO patterns.
 * Returns the raw date string portion, or null if no match.
 */
function matchReturnDateString(text: string): string | null {
  // Pattern groups ordered by specificity
  const patterns: RegExp[] = [
    // Broad OOO forms: "on leave until Monday 21st September" and
    // "out from August 27 through September 11". This parser is only invoked
    // after OOO detection, so a generic until/through is safe and catches more
    // provider-generated templates than an "out of office" prefix alone.
    /(?:until|through)\s+(.+?)(?:\.|;|\s+and\s|\s+but\s|\s+I\b|\s+if\b|$)/i,

    // "back on February 15" / "return on Feb 15th" / "returning on 2/15/2026"
    /(?:back|return|returning)\s+(?:to\s+(?:the\s+)?office\s+)?on\s+(.+?)(?:\.|;|\s+and\s|\s+but\s|\s+I\b|\s+if\b|$)/i,

    // "back in the office on February 15"
    /back\s+in\s+the\s+office\s+on\s+(.+?)(?:\.|;|\s+and\s|\s+but\s|\s+I\b|\s+if\b|$)/i,

    // "available again February 15" / "available starting Monday"
    /available\s+(?:again|starting)\s+(.+?)(?:\.|;|\s+and\s|\s+but\s|\s+I\b|\s+if\b|$)/i,

    // "will be back February 15" / "I'll be back Monday"
    /(?:will\s+be|I'?ll\s+be)\s+back\s+(.+?)(?:\.|;|\s+and\s|\s+but\s|\s+I\b|\s+if\b|$)/i,

    // "out of office until February 15" / "out until Monday"
    /out\s+(?:of\s+(?:the\s+)?office\s+)?until\s+(.+?)(?:\.|;|\s+and\s|\s+but\s|\s+I\b|\s+if\b|$)/i,

    // "returning Monday" / "returning February 15"
    /returning\s+(.+?)(?:\.|;|\s+and\s|\s+but\s|\s+I\b|\s+if\b|$)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const candidate = match[1].trim();
      // Sanity: only accept reasonably short date strings
      if (candidate.length <= 40) {
        return candidate;
      }
    }
  }

  return null;
}

// ============================================================================
// Date String Parsing
// ============================================================================

/**
 * Parse a raw date string into a Date object.
 * Handles named months, numeric dates, day names, and relative terms.
 */
function parseDateString(str: string): Date | null {
  const lower = str.toLowerCase().trim().replace(/[,\s]+$/, '');

  // ---- "tomorrow" ----
  if (/^tomorrow\b/.test(lower)) {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d;
  }

  // A provider often prefixes an explicit date with a weekday. Prefer the
  // explicit date ("Tuesday, September 17th") over calculating the next
  // Tuesday, which can be a different day.
  const withoutWeekday = lower.replace(
    /^(?:next\s+)?(?:sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?)\s*,?\s+/,
    '',
  );
  if (withoutWeekday !== lower) {
    const explicitAfterWeekday = parseNamedMonth(withoutWeekday) || parseNumericDate(withoutWeekday);
    if (explicitAfterWeekday) return explicitAfterWeekday;
  }

  // ---- Named month: "February 15", "Feb 15th", "February 15, 2026" ----
  const namedMonthResult = parseNamedMonth(lower);
  if (namedMonthResult) return namedMonthResult;

  // ---- Numeric: "2/15", "2/15/2026", "02/15/2026" ----
  const numericResult = parseNumericDate(lower);
  if (numericResult) return numericResult;

  // ---- Day of week: "Monday", "next Monday" ----
  const dayOfWeekResult = parseDayOfWeek(lower);
  if (dayOfWeekResult) return dayOfWeekResult;

  return null;
}

/**
 * Parse day-of-week references like "Monday", "next Tuesday".
 */
function parseDayOfWeek(str: string): Date | null {
  const isNext = /^next\s+/.test(str);
  const cleaned = str.replace(/^next\s+/, '');

  for (const [name, targetDay] of Object.entries(DAY_MAP)) {
    if (cleaned === name || cleaned.startsWith(name + ' ')) {
      const today = new Date();
      const currentDay = today.getDay();
      let daysUntil = targetDay - currentDay;

      if (isNext) {
        // "next Monday" means the Monday in the coming week
        if (daysUntil <= 0) daysUntil += 7;
        // If it's already positive, add another week only if it's the same day
        if (daysUntil === 0) daysUntil = 7;
      } else {
        // Plain "Monday" means the next occurrence
        if (daysUntil <= 0) daysUntil += 7;
      }

      const result = new Date();
      result.setDate(today.getDate() + daysUntil);
      result.setHours(9, 0, 0, 0);
      return result;
    }
  }

  return null;
}

/**
 * Parse named-month date strings.
 * Handles: "February 15", "Feb 15th", "Feb 15, 2026", "15 February 2026"
 */
function parseNamedMonth(str: string): Date | null {
  // Pattern: "Month Day[st/nd/rd/th][, Year]"
  const pattern1 = /^(\w+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*,?\s*(\d{4}))?/;
  const m1 = str.match(pattern1);
  if (m1) {
    const monthName = m1[1].toLowerCase();
    const month = MONTH_MAP[monthName];
    if (month !== undefined) {
      const day = parseInt(m1[2], 10);
      const year = m1[3] ? parseInt(m1[3], 10) : inferYear(month, day);
      return buildDate(year, month, day);
    }
  }

  // Pattern: "Day Month[, Year]" (e.g., "15 February 2026")
  const pattern2 = /^(\d{1,2})(?:st|nd|rd|th)?\s+(\w+)(?:\s*,?\s*(\d{4}))?/;
  const m2 = str.match(pattern2);
  if (m2) {
    const monthName = m2[2].toLowerCase();
    const month = MONTH_MAP[monthName];
    if (month !== undefined) {
      const day = parseInt(m2[1], 10);
      const year = m2[3] ? parseInt(m2[3], 10) : inferYear(month, day);
      return buildDate(year, month, day);
    }
  }

  return null;
}

/**
 * Parse numeric date strings.
 * Handles: "2/15", "2/15/2026", "02/15/2026", also with dashes.
 */
function parseNumericDate(str: string): Date | null {
  const pattern = /^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?/;
  const m = str.match(pattern);
  if (!m) return null;

  const first = parseInt(m[1], 10);
  const second = parseInt(m[2], 10);
  let year = m[3] ? parseInt(m[3], 10) : 0;

  // Handle 2-digit years
  if (year > 0 && year < 100) {
    year += 2000;
  }

  // Use D/M when the first component cannot be a month; otherwise retain the
  // historical M/D interpretation for ambiguous dates.
  const dayFirst = first > 12 && second <= 12;
  const month = (dayFirst ? second : first) - 1;
  const day = dayFirst ? first : second;

  if (month < 0 || month > 11 || day < 1 || day > 31) return null;

  if (!year) {
    year = inferYear(month, day);
  }

  return buildDate(year, month, day);
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Infer the year for a month/day with no explicit year.
 * If the date has already passed this year, assume next year.
 */
function inferYear(month: number, day: number): number {
  const now = new Date();
  const thisYear = now.getFullYear();

  const candidate = new Date(thisYear, month, day);
  // Allow 1 day of grace (OOO date might be today)
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);

  if (candidate < yesterday) {
    return thisYear + 1;
  }
  return thisYear;
}

/**
 * Build a Date object from year/month/day with basic validation.
 * Sets time to 9:00 AM local (reasonable "start of business" default).
 */
function buildDate(year: number, month: number, day: number): Date | null {
  if (month < 0 || month > 11 || day < 1 || day > 31 || year < 2020 || year > 2100) {
    return null;
  }

  const d = new Date(year, month, day, 9, 0, 0, 0);

  // Validate the date was actually valid (e.g., Feb 30 would roll over)
  if (d.getMonth() !== month || d.getDate() !== day) {
    return null;
  }

  return d;
}
