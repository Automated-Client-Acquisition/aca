/**
 * Per-country sending rules for SMS / WhatsApp Business marketing messages.
 *
 * Every country works: one not listed gets DEFAULT_RULES. Hours are checked in
 * the recipient's local time. For countries spanning several time zones a send
 * must fall inside the window in ALL listed zones (e.g. US: 08:00 in Los Angeles
 * is 11:00 in New York), which is conservative on purpose.
 *
 * Plan: tasks/sms-whatsapp-business-2026-10-25.md ("Country rules").
 */

export interface CountryRules {
  /** Local hour sending may start (inclusive) and must stop (exclusive). */
  startHour: number;
  endHour: number;
  /** 0 = Sunday … 6 = Saturday */
  blockedDays: number[];
  /** Time zones the window must hold in. Empty = only UTC is known (DEFAULT). */
  timeZones: string[];
  /** Public holidays when marketing sends are blocked (FR operator rule). */
  holidays?: (year: number) => string[]; // 'YYYY-MM-DD'
  /** Appended to marketing SMS when the text doesn't already contain `optOutKeyword`. */
  optOutText: string | null;
  optOutKeyword: string;
  /** Alphanumeric sender IDs are accepted by carriers. */
  alphanumericAllowed: boolean;
  /** Meta allows WhatsApp marketing templates to this country. */
  whatsappMarketingAllowed: boolean;
}

/** Western Easter Sunday (anonymous Gregorian algorithm). */
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function frenchHolidays(year: number): string[] {
  const easter = easterSunday(year);
  const plus = (days: number) => isoDay(new Date(easter.getTime() + days * 86_400_000));
  return [
    `${year}-01-01`, `${year}-05-01`, `${year}-05-08`, `${year}-07-14`,
    `${year}-08-15`, `${year}-11-01`, `${year}-11-11`, `${year}-12-25`,
    plus(1),  // Easter Monday
    plus(39), // Ascension
    plus(50), // Whit Monday
  ];
}

export const DEFAULT_RULES: CountryRules = {
  startHour: 10,
  endHour: 17,
  blockedDays: [0],
  timeZones: [],
  optOutText: 'Reply STOP to opt out',
  optOutKeyword: 'STOP',
  alphanumericAllowed: true,
  whatsappMarketingAllowed: true,
};

const RULES: Record<string, Partial<CountryRules>> = {
  US: {
    startHour: 8, endHour: 20, blockedDays: [],
    timeZones: ['America/New_York', 'America/Los_Angeles'],
    alphanumericAllowed: false,
    whatsappMarketingAllowed: false,
  },
  CA: {
    startHour: 9, endHour: 21, blockedDays: [],
    timeZones: ['America/Toronto', 'America/Vancouver'],
    alphanumericAllowed: false,
  },
  GB: { startHour: 8, endHour: 21, blockedDays: [], timeZones: ['Europe/London'] },
  IE: { startHour: 9, endHour: 20, blockedDays: [0], timeZones: ['Europe/Dublin'] },
  FR: {
    startHour: 8, endHour: 20, blockedDays: [0],
    timeZones: ['Europe/Paris'],
    holidays: frenchHolidays,
    optOutText: 'STOP au 36111',
    optOutKeyword: '36111',
  },
  BE: { startHour: 9, endHour: 20, blockedDays: [0], timeZones: ['Europe/Brussels'] },
  CH: { startHour: 9, endHour: 20, blockedDays: [0], timeZones: ['Europe/Zurich'] },
  LU: { startHour: 9, endHour: 20, blockedDays: [0], timeZones: ['Europe/Luxembourg'] },
  DE: { startHour: 9, endHour: 20, blockedDays: [0], timeZones: ['Europe/Berlin'] },
  AT: { startHour: 9, endHour: 20, blockedDays: [0], timeZones: ['Europe/Vienna'] },
  NL: { startHour: 9, endHour: 20, blockedDays: [0], timeZones: ['Europe/Amsterdam'] },
  ES: { startHour: 9, endHour: 21, blockedDays: [0], timeZones: ['Europe/Madrid'] },
  PT: { startHour: 9, endHour: 21, blockedDays: [0], timeZones: ['Europe/Lisbon'] },
  IT: { startHour: 9, endHour: 20, blockedDays: [0], timeZones: ['Europe/Rome'] },
  AU: {
    startHour: 9, endHour: 20, blockedDays: [0],
    timeZones: ['Australia/Sydney', 'Australia/Perth'],
  },
  NZ: { startHour: 9, endHour: 20, blockedDays: [0], timeZones: ['Pacific/Auckland'] },
  ZA: { startHour: 8, endHour: 20, blockedDays: [0], timeZones: ['Africa/Johannesburg'] },
  AE: { startHour: 9, endHour: 20, blockedDays: [], timeZones: ['Asia/Dubai'] },
  IL: { startHour: 9, endHour: 20, blockedDays: [6], timeZones: ['Asia/Jerusalem'] },
  IN: { startHour: 10, endHour: 19, blockedDays: [0], timeZones: ['Asia/Kolkata'] },
  SG: { startHour: 9, endHour: 20, blockedDays: [], timeZones: ['Asia/Singapore'] },
  HK: { startHour: 9, endHour: 20, blockedDays: [], timeZones: ['Asia/Hong_Kong'] },
  BR: { startHour: 9, endHour: 20, blockedDays: [0], timeZones: ['America/Sao_Paulo'] },
  MX: { startHour: 9, endHour: 20, blockedDays: [0], timeZones: ['America/Mexico_City'] },
  MA: { startHour: 9, endHour: 20, blockedDays: [0], timeZones: ['Africa/Casablanca'] },
};

// Same rules as a neighbour: Crown dependencies follow GB.
const ALIASES: Record<string, string> = { GG: 'GB', JE: 'GB', IM: 'GB' };

export function rulesFor(country: string | null | undefined): CountryRules {
  const code = country ? (ALIASES[country.toUpperCase()] ?? country.toUpperCase()) : '';
  return { ...DEFAULT_RULES, ...(RULES[code] ?? {}) };
}

interface LocalTime { hour: number; minute: number; weekday: number; date: string }

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function localTime(at: Date, timeZone: string): LocalTime {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', weekday: 'short',
    }).formatToParts(at).map((p) => [p.type, p.value]),
  );
  return {
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: WEEKDAYS[parts.weekday as string] ?? 0,
    date: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

/** Can a marketing message be sent to this country at `at`? */
export function isSendAllowed(country: string | null | undefined, at: Date = new Date()): boolean {
  const rules = rulesFor(country);
  const zones = rules.timeZones.length > 0 ? rules.timeZones : ['UTC'];
  return zones.every((zone) => {
    const t = localTime(at, zone);
    if (rules.blockedDays.includes(t.weekday)) return false;
    if (rules.holidays?.(Number(t.date.slice(0, 4))).includes(t.date)) return false;
    return t.hour >= rules.startHour && t.hour < rules.endHour;
  });
}

/**
 * The next moment sending is allowed (now if it already is). Steps in 15-minute
 * increments for up to 8 days; a country whose window never opens returns null.
 */
export function nextSendWindow(country: string | null | undefined, from: Date = new Date()): Date | null {
  if (isSendAllowed(country, from)) return from;
  const step = 15 * 60_000;
  let t = Math.ceil(from.getTime() / step) * step;
  const limit = from.getTime() + 8 * 86_400_000;
  for (; t <= limit; t += step) {
    if (isSendAllowed(country, new Date(t))) {
      // Spread queued leads over the first half hour instead of all at the opening minute
      return new Date(t + Math.floor(Math.random() * 30 * 60_000));
    }
  }
  return null;
}

/** Append the country's opt-out wording unless the text already carries it. */
export function withOptOut(text: string, country: string | null | undefined): string {
  const rules = rulesFor(country);
  if (!rules.optOutText) return text;
  if (text.toUpperCase().includes(rules.optOutKeyword.toUpperCase())) return text;
  return `${text.trimEnd()}\n${rules.optOutText}`;
}

/** Inbound text that means "stop messaging me" / "start again", in the languages we send in. */
const STOP_WORDS = new Set([
  'STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'OPTOUT', 'OPT OUT', 'REVOKE',
  'ARRET', 'ARRÊT', 'DESABONNER', 'DÉSABONNER', 'STOP SMS', 'BAJA', 'ALTO', 'PARAR', 'ABMELDEN',
]);
const START_WORDS = new Set(['START', 'UNSTOP', 'SUBSCRIBE']);

export function optKeyword(text: string): 'stop' | 'start' | null {
  const normalized = text.trim().toUpperCase().replace(/[.!]+$/, '');
  if (STOP_WORDS.has(normalized)) return 'stop';
  if (START_WORDS.has(normalized)) return 'start';
  return null;
}
