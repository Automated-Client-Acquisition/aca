/**
 * Phone normalisation to E.164 for SMS / WhatsApp Business.
 *
 * Stored phones are mostly national format with no country code ("5551234567",
 * "(555) 123-4567"), sometimes two numbers in one field ("555..., 555..."), and
 * country names come in every shape ("US", "United States", "UK", "us").
 *
 * Country order for numbers without "+": contact country → company country →
 * org default. If none of those parses as a valid number, the digits are tried
 * as an international number without the "+" ("33612345678").
 */
import { parsePhoneNumberFromString, type CountryCode } from 'npm:libphonenumber-js@1/max';

export type CountrySource = 'number' | 'contact' | 'company' | 'org_default';

export interface NormalizedPhone {
  source_phone: string;
  status: 'valid' | 'invalid' | 'no_country';
  phone_e164: string | null;
  phone_country: string | null;
  line_type: string | null;
  country_source: CountrySource | null;
}

export interface CountryHints {
  contact?: string | null;
  company?: string | null;
  orgDefault?: string | null;
}

// Names Intl.DisplayNames doesn't produce, or that people write differently.
const COUNTRY_ALIASES: Record<string, string> = {
  uk: 'GB', 'great britain': 'GB', britain: 'GB', england: 'GB', scotland: 'GB', wales: 'GB',
  'northern ireland': 'GB', usa: 'US', 'u.s.': 'US', 'u.s.a.': 'US', america: 'US',
  'united states of america': 'US', uae: 'AE', 'south korea': 'KR', korea: 'KR', russia: 'RU',
  'czech republic': 'CZ', holland: 'NL', 'the netherlands': 'NL', vietnam: 'VN',
  'hong kong': 'HK', 'ivory coast': 'CI', turkey: 'TR',
};

// Legacy / grouping codes Intl.DisplayNames still names ("Germany" is DD and DE,
// "France" is FR and FX); never map a name to these.
const LEGACY_REGION_CODES = new Set(['AN', 'BU', 'CS', 'DD', 'EU', 'EZ', 'FX', 'NT', 'QO', 'SU', 'TP', 'UK', 'UN', 'YD', 'YU', 'ZR', 'ZZ']);

let nameToIso: Map<string, string> | null = null;

function countryNameMap(): Map<string, string> {
  if (nameToIso) return nameToIso;
  nameToIso = new Map();
  const names = new Intl.DisplayNames(['en'], { type: 'region' });
  for (let a = 65; a <= 90; a++) {
    for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a, b);
      if (LEGACY_REGION_CODES.has(code)) continue;
      let name: string | undefined;
      try {
        name = names.of(code);
      } catch {
        continue;
      }
      // Unknown codes come back unchanged
      if (!name || name === code) continue;
      nameToIso.set(name.toLowerCase(), code);
      // "Myanmar (Burma)" → also "myanmar"
      const short = name.replace(/\s*\(.*\)$/, '').toLowerCase();
      if (short !== name.toLowerCase() && !nameToIso.has(short)) nameToIso.set(short, code);
    }
  }
  return nameToIso;
}

/** "United Kingdom" / "UK" / "gb" / "USA" → ISO alpha-2, or null. */
export function toCountryCode(input: string | null | undefined): string | null {
  if (!input) return null;
  const value = input.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!value) return null;
  if (COUNTRY_ALIASES[value]) return COUNTRY_ALIASES[value];
  if (/^[a-z]{2}$/.test(value)) {
    const code = value.toUpperCase();
    return code === 'UK' ? 'GB' : code;
  }
  return countryNameMap().get(value) ?? null;
}

/** First number from a field that may hold several ("555..., 555..." or "a / b"). */
export function firstPhone(raw: string): string {
  return raw.split(/[,;/|]| or /i)[0].trim();
}

function parseAs(input: string, country?: string) {
  const parsed = parsePhoneNumberFromString(input, country as CountryCode | undefined);
  return parsed && parsed.isValid() ? parsed : null;
}

export function normalizePhone(raw: string | null | undefined, hints: CountryHints = {}): NormalizedPhone | null {
  if (!raw || !raw.trim()) return null;
  const source_phone = raw.trim();
  let candidate = firstPhone(source_phone);
  if (candidate.startsWith('00')) candidate = '+' + candidate.slice(2);
  const digits = candidate.replace(/\D/g, '');
  if (digits.length < 6) {
    return { source_phone, status: 'invalid', phone_e164: null, phone_country: null, line_type: null, country_source: null };
  }

  const valid = (parsed: NonNullable<ReturnType<typeof parseAs>>, country_source: CountrySource): NormalizedPhone => ({
    source_phone,
    status: 'valid',
    phone_e164: parsed.number,
    phone_country: parsed.country ?? null,
    line_type: parsed.getType() ?? null,
    country_source,
  });

  if (candidate.startsWith('+')) {
    const parsed = parseAs(candidate);
    return parsed
      ? valid(parsed, 'number')
      : { source_phone, status: 'invalid', phone_e164: null, phone_country: null, line_type: null, country_source: null };
  }

  const countries: [CountrySource, string | null][] = [
    ['contact', toCountryCode(hints.contact)],
    ['company', toCountryCode(hints.company)],
    ['org_default', toCountryCode(hints.orgDefault)],
  ];
  const tried = new Set<string>();
  for (const [source, country] of countries) {
    if (!country || tried.has(country)) continue;
    tried.add(country);
    const parsed = parseAs(candidate, country);
    if (parsed) return valid(parsed, source);
  }

  // International number written without the "+". 11+ digits only: a bare 10-digit
  // US number "5551234567" would otherwise parse as Brazil (+55).
  if (digits.length >= 11) {
    const parsed = parseAs('+' + digits);
    if (parsed) return valid(parsed, 'number');
  }

  return {
    source_phone,
    status: tried.size > 0 ? 'invalid' : 'no_country',
    phone_e164: null,
    phone_country: null,
    line_type: null,
    country_source: null,
  };
}
