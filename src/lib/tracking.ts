/**
 * Ad conversion tracking - Meta, Google Ads/GA4, LinkedIn.
 *
 * One funnel event vocabulary, mapped to each platform's naming, so the wizard
 * fires `track("signup_started")` once rather than juggling fbq/gtag/lintrk at
 * every call site.
 *
 * Everything here no-ops when the corresponding env var is unset, so an
 * unconfigured environment (local dev, preview builds) stays silent instead of
 * throwing or polluting a real ad account.
 *
 * Deliberately NOT loaded until `initTracking()` is called, and that call is
 * gated on consent - see hasTrackingConsent().
 */

const META_PIXEL_ID = import.meta.env.VITE_META_PIXEL_ID as string | undefined;
const GA4_ID = import.meta.env.VITE_GA4_ID as string | undefined;
const GOOGLE_ADS_ID = import.meta.env.VITE_GOOGLE_ADS_ID as string | undefined;
const LINKEDIN_PARTNER_ID = import.meta.env.VITE_LINKEDIN_PARTNER_ID as string | undefined;

/**
 * Google Ads conversion labels, one per funnel event we want to optimise for.
 * Format: "AW-123456789/AbCdEfGhIjK". Only the events you actually bid on need
 * a label; the rest still land in GA4 as plain events.
 */
const GOOGLE_ADS_LABELS: Partial<Record<FunnelEvent, string | undefined>> = {
  signup_started: import.meta.env.VITE_GADS_LABEL_SIGNUP as string | undefined,
  trial_started: import.meta.env.VITE_GADS_LABEL_TRIAL as string | undefined,
};

/** LinkedIn fires numeric conversion ids rather than named events. */
const LINKEDIN_CONVERSIONS: Partial<Record<FunnelEvent, string | undefined>> = {
  signup_started: import.meta.env.VITE_LI_CONVERSION_SIGNUP as string | undefined,
  trial_started: import.meta.env.VITE_LI_CONVERSION_TRIAL as string | undefined,
};

/** The funnel, in order. Keep this list short - every event should be one you'd act on. */
export type FunnelEvent =
  | "wizard_viewed"      // landed on /get-started
  | "wizard_started"     // clicked through the welcome screen
  | "lead_captured"      // gave us name + email + website
  | "signup_started"     // submitted, workspace provisioning began
  | "signup_completed"   // all artifacts built, reveal screen shown
  | "checkout_started"   // clicked through to Stripe
  | "trial_started";     // came back from Stripe having put a card down

/** Meta's standard events, which optimise better than custom ones. */
const META_STANDARD: Partial<Record<FunnelEvent, string>> = {
  lead_captured: "Lead",
  signup_started: "CompleteRegistration",
  checkout_started: "InitiateCheckout",
  trial_started: "StartTrial",
};

declare global {
  interface Window {
    fbq?: ((...args: unknown[]) => void) & { callMethod?: (...args: unknown[]) => void; queue?: unknown[] };
    _fbq?: unknown;
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    lintrk?: (...args: unknown[]) => void;
    _linkedin_data_partner_ids?: string[];
  }
}

let initialised = false;

const CONSENT_KEY = "aca:tracking-consent";

/**
 * Consent gate. Defaults to allowed, which is the pragmatic B2B posture, but
 * anything calling setTrackingConsent(false) stops all three platforms dead -
 * nothing further loads and no event fires.
 *
 * If you later add a cookie banner, wire it to setTrackingConsent() and flip
 * the default here to false for EU traffic.
 */
export function hasTrackingConsent(): boolean {
  try {
    return localStorage.getItem(CONSENT_KEY) !== "denied";
  } catch {
    return true;
  }
}

export function setTrackingConsent(granted: boolean): void {
  try {
    localStorage.setItem(CONSENT_KEY, granted ? "granted" : "denied");
  } catch { /* storage disabled - nothing to persist */ }
}

function loadMeta(): void {
  if (!META_PIXEL_ID || window.fbq) return;
  /* eslint-disable */
  // Meta's own loader, inlined. The queue shim matters: it lets us fire events
  // immediately without waiting for fbevents.js to finish downloading.
  const n: any = (window.fbq = function (...args: unknown[]) {
    n.callMethod ? n.callMethod.apply(n, args) : n.queue!.push(args);
  } as any);
  if (!window._fbq) window._fbq = n;
  n.push = n; n.loaded = true; n.version = "2.0"; n.queue = [];
  /* eslint-enable */
  const s = document.createElement("script");
  s.async = true;
  s.src = "https://connect.facebook.net/en_US/fbevents.js";
  document.head.appendChild(s);
  window.fbq("init", META_PIXEL_ID);
}

function loadGoogle(): void {
  const id = GA4_ID || GOOGLE_ADS_ID;
  if (!id || window.gtag) return;
  const s = document.createElement("script");
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${id}`;
  document.head.appendChild(s);
  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() {
    // Must push `arguments`, not a rest array - gtag reads the arguments object.
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments);
  };
  window.gtag("js", new Date());
  if (GA4_ID) window.gtag("config", GA4_ID);
  // Both tags can share one gtag.js load; config each separately.
  if (GOOGLE_ADS_ID && GOOGLE_ADS_ID !== GA4_ID) window.gtag("config", GOOGLE_ADS_ID);
}

function loadLinkedIn(): void {
  if (!LINKEDIN_PARTNER_ID || window.lintrk) return;
  window._linkedin_data_partner_ids = window._linkedin_data_partner_ids || [];
  window._linkedin_data_partner_ids.push(LINKEDIN_PARTNER_ID);
  const s = document.createElement("script");
  s.async = true;
  s.src = "https://snap.licdn.com/li.lms-analytics/insight.min.js";
  document.head.appendChild(s);
}

/** Load whichever platforms are configured. Safe to call more than once. */
export function initTracking(): void {
  if (initialised || typeof window === "undefined") return;
  if (!hasTrackingConsent()) return;
  initialised = true;
  try { loadMeta(); } catch (e) { console.warn("[tracking] meta init failed", e); }
  try { loadGoogle(); } catch (e) { console.warn("[tracking] google init failed", e); }
  try { loadLinkedIn(); } catch (e) { console.warn("[tracking] linkedin init failed", e); }
}

/**
 * Fire one funnel event to every configured platform.
 *
 * Never throws: a broken or blocked pixel must not take a signup down with it.
 * `value` is in whole currency units and only matters for revenue events.
 */
export function track(event: FunnelEvent, params?: Record<string, unknown>): void {
  if (typeof window === "undefined" || !hasTrackingConsent()) return;
  try {
    // Meta - standard event where one fits, custom otherwise.
    if (window.fbq) {
      const standard = META_STANDARD[event];
      if (standard) window.fbq("track", standard, params);
      else window.fbq("trackCustom", event, params);
    }

    // GA4 gets every event by its funnel name; Google Ads gets the ones we bid on.
    if (window.gtag) {
      window.gtag("event", event, params || {});
      const label = GOOGLE_ADS_LABELS[event];
      if (label) window.gtag("event", "conversion", { send_to: label, ...(params || {}) });
    }

    // LinkedIn, by numeric conversion id.
    if (window.lintrk) {
      const conversionId = LINKEDIN_CONVERSIONS[event];
      if (conversionId) window.lintrk("track", { conversion_id: conversionId });
    }
  } catch (e) {
    console.warn("[tracking] event failed", event, e);
  }
}
