export type OnboardingStep = "welcome" | "about" | "build" | "ready";
export interface OnboardingJob {
  jobId: string;
  organizationId: string;
  provisioningToken: string;
  tasksDone?: Record<string, string>;
  returningUser?: boolean;
}

export function isOnboardingJob(value: unknown): value is OnboardingJob {
  if (!value || typeof value !== "object") return false;
  const job = value as Record<string, unknown>;
  return ["jobId", "organizationId", "provisioningToken"].every(
    (key) => typeof job[key] === "string" && (job[key] as string).trim().length > 0,
  );
}

export function readOnboardingSession<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw || raw.length > 100_000) return null;
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? value as T : null;
  } catch { return null; }
}

// Query strings and stale saved steps cannot bypass the anonymous preview or
// render a completed workspace without a valid provisioning job.
export function resolveOnboardingStep({ urlStep, savedStep, hasJob, hasPreview, handoff }: {
  urlStep?: string | null; savedStep?: string | null;
  hasJob: boolean; hasPreview: boolean; handoff: boolean;
}): OnboardingStep {
  if (hasJob) return urlStep === "ready" || savedStep === "ready" ? "ready" : "build";
  if (hasPreview && (handoff || urlStep === "about" || savedStep === "about")) return "about";
  return "welcome";
}
