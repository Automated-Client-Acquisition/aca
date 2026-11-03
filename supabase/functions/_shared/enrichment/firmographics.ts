/**
 * Firmographic normalization shared by every write path that populates
 * crm_contacts.enrichment_data.company (enrichment write-back, CSV import).
 *
 * Providers and CSV columns report employee count in incompatible shapes —
 * a plain number, "20 - 99", "20-99 employees", an open-ended "5000+", or
 * an already-clean band. Filtering and the Advanced Filters dropdown both
 * read enrichment_data.company.size as a flat string, so without a shared
 * vocabulary the same underlying company shows up under several different
 * strings. This bands everything into the 8-value convention already used
 * by lead_pool_verified.employee_range.
 */

export const EMPLOYEE_RANGE_BANDS = [
  '1-10', '11-20', '21-50', '51-200', '201-500', '501-1000', '1001-5000', '5001+',
] as const;

export type EmployeeRangeBand = typeof EMPLOYEE_RANGE_BANDS[number];

const BAND_THRESHOLDS: Array<{ max: number; band: EmployeeRangeBand }> = [
  { max: 10, band: '1-10' },
  { max: 20, band: '11-20' },
  { max: 50, band: '21-50' },
  { max: 200, band: '51-200' },
  { max: 500, band: '201-500' },
  { max: 1000, band: '501-1000' },
  { max: 5000, band: '1001-5000' },
  { max: Infinity, band: '5001+' },
];

function bandForCount(n: number): EmployeeRangeBand {
  for (const t of BAND_THRESHOLDS) {
    if (n <= t.max) return t.band;
  }
  return '5001+';
}

/**
 * Parse a messy employee-count value into one of the 8 canonical bands.
 * A two-number range ("20 - 99") is bucketed on its midpoint — providers
 * disagree on band edges, so the midpoint is the single best point estimate,
 * not an exact fit.
 *
 * Returns null when nothing usable can be parsed — callers should fall back
 * to the original raw value rather than discard data outright.
 */
export function normalizeEmployeeRange(
  raw: string | number | { min?: number; max?: number } | null | undefined
): EmployeeRangeBand | null {
  if (raw === null || raw === undefined) return null;

  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw > 0 ? bandForCount(raw) : null;
  }

  if (typeof raw === 'object') {
    const { min, max } = raw;
    if (typeof min === 'number' && typeof max === 'number') return bandForCount((min + max) / 2);
    if (typeof max === 'number') return bandForCount(max);
    if (typeof min === 'number') return bandForCount(min);
    return null;
  }

  const trimmed = raw.trim();
  if (!trimmed) return null;

  const exact = EMPLOYEE_RANGE_BANDS.find(b => b.toLowerCase() === trimmed.toLowerCase());
  if (exact) return exact;

  const numbers = trimmed.match(/\d+/g)?.map(Number) ?? [];
  if (numbers.length === 0) return null;
  if (numbers.length === 1) return bandForCount(numbers[0]);

  const a = numbers[0];
  const b = numbers[1];
  return bandForCount((Math.min(a, b) + Math.max(a, b)) / 2);
}

/**
 * Formatting cleanup only — trims whitespace and collapses internal runs.
 * Deliberately doesn't fuzzy-match against a master taxonomy ("SaaS" vs
 * "Software" stay distinct); that would need a curated mapping to avoid
 * merging genuinely different industries.
 */
export function normalizeIndustryLabel(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  return trimmed || null;
}
