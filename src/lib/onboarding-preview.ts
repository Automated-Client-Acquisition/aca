import type { SandboxDemo } from "@/data/sandbox/demos";

export type OnboardingPreviewDraft = {
  version: 1;
  kind: "live" | "sample";
  website: string;
  linkedinUrl: string;
  preview: SandboxDemo;
  savedAt: number;
};

const PREVIEW_KEY = "aca:onboarding:preview";
const PREVIEW_MAX_AGE = 24 * 60 * 60 * 1000;
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.length <= 100_000;
const texts = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 100 && value.every(text);

/** Only public DNS websites; never send credentials, IPs, or local URLs to the preview service. */
export function normalizePreviewWebsite(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > 2048 || /\s/.test(trimmed) || /[\\]/.test(trimmed)) return null;
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`);
    const host = url.hostname.toLowerCase();
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port) return null;
    if (!/^(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+[a-z]{2,63}$/.test(host)) return null;
    if (/(^|\.)(localhost|local|internal|test|invalid|example|onion)$/.test(host)) return null;
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch { return null; }
}

export function isOnboardingPreviewDraft(value: unknown): value is OnboardingPreviewDraft {
  if (!record(value) || value.version !== 1 || !["live", "sample"].includes(String(value.kind))) return false;
  if (!text(value.website) || !text(value.linkedinUrl) || typeof value.savedAt !== "number" || !Number.isFinite(value.savedAt)) return false;
  if (value.savedAt > Date.now() + 60_000 || Date.now() - value.savedAt > PREVIEW_MAX_AGE) return false;
  if (value.kind === "sample" && (value.website !== "" || value.linkedinUrl !== "")) return false;
  if (value.kind === "live" && normalizePreviewWebsite(value.website) === null) return false;
  const p = value.preview;
  if (!record(p) || !["id", "hero", "name", "website", "linkedinUrl", "founderName", "goal", "knowledge", "contentPlanPreview", "strategyPreview"].every((key) => text(p[key]))) return false;
  if (!texts(p.pains) || !texts(p.campaignSteps)) return false;
  if (!record(p.icp) || !["name", "summary", "industry", "roles", "language"].every((key) => text(p.icp[key])) || !texts(p.icp.pains) || !texts(p.icp.desires)) return false;
  if (!record(p.product) || !["name", "description", "category"].every((key) => text(p.product[key])) || !texts(p.product.features)) return false;
  if (!record(p.sequence) || !text(p.sequence.name) || !Array.isArray(p.sequence.steps) || p.sequence.steps.length > 100 || !p.sequence.steps.every((s) => record(s) && text(s.body) && (s.subject === undefined || text(s.subject)) && ["email", "linkedin"].includes(String(s.channel)) && typeof s.step === "number" && typeof s.delay_days === "number")) return false;
  if (!record(p.blueprint) || !text(p.blueprint.name) || !Array.isArray(p.blueprint.themes) || p.blueprint.themes.length > 100 || !p.blueprint.themes.every((t) => record(t) && ["theme", "frequency", "hook_pattern", "example_post"].every((key) => text(t[key])))) return false;
  if (!record(p.agent) || !text(p.agent.name) || !text(p.agent.description) || !texts(p.agent.tone_traits) || !texts(p.agent.escalation_triggers)) return false;
  if (!record(p.audit) || !["overall", "headline_score", "about_score", "banner_score", "activity_score"].every((key) => typeof p.audit[key] === "number" && Number.isFinite(p.audit[key])) || !["headline_rewrite", "about_rewrite", "summary"].every((key) => text(p.audit[key])) || !texts(p.audit.recommendations)) return false;
  return true;
}

export function loadOnboardingPreview(): OnboardingPreviewDraft | null {
  try {
    const stored = sessionStorage.getItem(PREVIEW_KEY);
    if (!stored) return null;
    if (stored.length > 250_000) { sessionStorage.removeItem(PREVIEW_KEY); return null; }
    const parsed: unknown = JSON.parse(stored);
    if (isOnboardingPreviewDraft(parsed)) return parsed;
    sessionStorage.removeItem(PREVIEW_KEY);
  } catch {
    // Discard invalid JSON while tolerating browsers that block storage entirely.
    try { sessionStorage.removeItem(PREVIEW_KEY); } catch { /* Preview still works in memory. */ }
  }
  return null;
}

export function saveOnboardingPreview(draft: OnboardingPreviewDraft): boolean {
  if (!isOnboardingPreviewDraft(draft)) return false;
  try {
    const serialized = JSON.stringify(draft);
    if (serialized.length > 250_000) return false;
    sessionStorage.setItem(PREVIEW_KEY, serialized);
    return true;
  } catch { return false; }
}

export function clearOnboardingPreview(): void {
  try { sessionStorage.removeItem(PREVIEW_KEY); } catch { /* Storage can be unavailable. */ }
}
