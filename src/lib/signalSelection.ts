/**
 * Handoff for B2B signals picked on the public /signals page into the
 * authenticated app (onboarding outbound quick-win + campaign builder).
 *
 * Public visitors aren't logged in, so the selection has to survive the
 * /auth → /onboarding → /campaigns/new journey — including a full-page OAuth
 * redirect. We use localStorage (survives the redirect, unlike a single-tab
 * in-memory store) with a short TTL so a stale pick doesn't resurface days
 * later. No backend: this is a visual pre-load only.
 */

const STORAGE_KEY = "aca:pendingSignalSelection";
const TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

/** Minimal, company-level fields needed to show the picked signals downstream. */
export interface PickedSignal {
  id: string;
  type: string;
  type_label: string;
  company: string;
  person: string;
  location: string;
  summary: string;
  date: string;
  source: string;
  source_url: string;
}

export interface PendingSignalSelection {
  signals: PickedSignal[];
  /** The filter context that produced the selection, for analytics / pre-fill. */
  filter: {
    type: string;
    query: string;
    verifiedOnly: boolean;
  };
  savedAt: number;
}

export function savePendingSignalSelection(
  signals: PickedSignal[],
  filter: PendingSignalSelection["filter"],
): void {
  if (typeof window === "undefined" || !signals.length) return;
  try {
    const payload: PendingSignalSelection = { signals, filter, savedAt: Date.now() };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Storage unavailable (private mode / quota) — selection just won't carry over.
  }
}

export function loadPendingSignalSelection(): PendingSignalSelection | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingSignalSelection;
    if (
      !parsed ||
      !Array.isArray(parsed.signals) ||
      !parsed.signals.length ||
      typeof parsed.savedAt !== "number" ||
      Date.now() - parsed.savedAt > TTL_MS
    ) {
      clearPendingSignalSelection();
      return null;
    }
    return parsed;
  } catch {
    clearPendingSignalSelection();
    return null;
  }
}

export function clearPendingSignalSelection(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
