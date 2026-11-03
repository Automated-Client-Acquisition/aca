/**
 * Ad attribution capture.
 *
 * Paid traffic arrives with click ids and UTMs on the landing URL, but the
 * signup happens several steps later - and often after a refresh, a tab
 * restore, or a bounce out to LinkedIn and back. If we only read them at
 * submit time they are long gone, and every paid signup looks organic.
 *
 * So: stamp once on first touch, keep it in localStorage for 30 days, and
 * attach it to the lead when they finally convert. First touch wins, because
 * the ad that introduced them is the one that earned the credit - a later
 * direct visit shouldn't overwrite it.
 */

const STORAGE_KEY = "aca:attribution";
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface Attribution {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  /** Google Ads click id - needed for offline conversion import. */
  gclid?: string;
  /** Meta click id - needed for the Conversions API. */
  fbclid?: string;
  /** LinkedIn Ads click id. */
  li_fat_id?: string;
  /** Where they first landed, so we can tell which page the ad pointed at. */
  landing_path?: string;
  /** External referrer on first touch, if any. */
  referrer?: string;
  /** True when this visit came from a paid placement. Drives the checkout rule. */
  paid?: boolean;
  /** First-touch timestamp (ISO). */
  first_seen_at?: string;
}

const PARAM_KEYS: Array<keyof Attribution> = [
  "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
  "gclid", "fbclid", "li_fat_id",
];

/** Paid if any click id is present, or the medium looks like bought traffic. */
function isPaid(a: Attribution): boolean {
  if (a.gclid || a.fbclid || a.li_fat_id) return true;
  const medium = (a.utm_medium || "").toLowerCase();
  return ["cpc", "ppc", "paid", "paidsocial", "paid_social", "display", "retargeting"].includes(medium);
}

function readFromUrl(): Attribution | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const found: Attribution = {};
  let any = false;
  for (const k of PARAM_KEYS) {
    const v = params.get(k as string);
    if (v) { (found as Record<string, string>)[k as string] = v.slice(0, 200); any = true; }
  }
  // An external referrer is worth keeping even with no UTMs - it still tells
  // us where organic traffic came from.
  let referrer = "";
  try {
    if (document.referrer && !document.referrer.includes(window.location.host)) {
      referrer = document.referrer.slice(0, 300);
    }
  } catch { /* ignore */ }
  if (!any && !referrer) return null;

  found.landing_path = window.location.pathname.slice(0, 200);
  if (referrer) found.referrer = referrer;
  found.first_seen_at = new Date().toISOString();
  found.paid = isPaid(found);
  return found;
}

/**
 * Call once on app boot. Stores first-touch attribution if we don't already
 * have a live one.
 */
export function captureAttribution(): void {
  if (typeof window === "undefined") return;
  try {
    const existing = loadAttribution();
    if (existing) return; // first touch wins
    const fresh = readFromUrl();
    if (!fresh) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...fresh, _t: Date.now() }));
  } catch { /* private mode / storage disabled - attribution is best-effort */ }
}

/** Returns stored attribution, or null when absent or older than the TTL. */
export function loadAttribution(): Attribution | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Attribution & { _t?: number };
    if (!parsed._t || Date.now() - parsed._t > TTL_MS) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    const { _t, ...rest } = parsed;
    return rest;
  } catch {
    return null;
  }
}

/** True when the current visitor should be treated as paid traffic. */
export function isPaidVisitor(): boolean {
  return loadAttribution()?.paid === true;
}
