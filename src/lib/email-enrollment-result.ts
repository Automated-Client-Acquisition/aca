/** Counts returned by enroll-leads, including its early-return exclusion reasons. */
export interface EmailEnrollmentResult {
  enrolled: number;
  skipped: number;
  noEmail: number;
  suppressed: number;
  alreadyInAnotherSequence: number;
  filteredOut: number;
  awaitingPipeline: number;
  missingContent: number;
  leadsWithoutContact: number;
  moved: number;
}

export interface EmailEnrollmentOutcome {
  tone: "success" | "warning" | "neutral";
  title: string;
  description: string;
}

export interface EmailEnrollmentPreview extends EmailEnrollmentResult {
  dryRun: true;
  totalContacts: number;
  eligible: number;
  conflictingSequences: Array<{ id: string; name: string; count: number }>;
}

export function normalizeEmailEnrollmentPreview(data: unknown): EmailEnrollmentPreview {
  const source = data && typeof data === "object" ? data as Record<string, unknown> : {};
  if (source.dryRun !== true || typeof source.eligible !== "number" || typeof source.totalContacts !== "number"
    || !Number.isInteger(source.eligible) || !Number.isInteger(source.totalContacts)
    || source.eligible < 0 || source.totalContacts < source.eligible) {
    throw new Error("The eligibility check returned an invalid response. Please retry.");
  }
  return {
    ...normalizeEmailEnrollmentResult(data),
    dryRun: true,
    totalContacts: source.totalContacts,
    eligible: source.eligible,
    conflictingSequences: Array.isArray(source.conflictingSequences)
      ? source.conflictingSequences.filter((item): item is { id: string; name: string; count: number } =>
        item && typeof item.id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.id)
        && typeof item.name === "string" && Number.isInteger(item.count) && item.count > 0)
      : [],
  };
}

export function getEmailEnrollmentReasons(result: EmailEnrollmentResult) {
  return [
    { key: "alreadyEnrolled", count: Math.max(0, result.skipped - result.filteredOut - result.awaitingPipeline), label: "Already enrolled here", detail: "Existing enrollments are kept as they are." },
    { key: "alreadyInAnotherSequence", count: result.alreadyInAnotherSequence, label: "Active in another sequence", detail: "These contacts stay in their current sequence to avoid overlapping outreach." },
    { key: "noEmail", count: result.noEmail, label: "No email address", detail: "Add an email address before enrolling these contacts." },
    { key: "suppressed", count: result.suppressed, label: "Unsubscribed or blocked", detail: "Unsubscribed, bounced, and do-not-contact addresses are excluded." },
    { key: "filteredOut", count: result.filteredOut, label: "Outside the enrollment filter", detail: "These contacts don't match this sequence's enrollment rules." },
    { key: "awaitingPipeline", count: result.awaitingPipeline, label: "Not approved by lead processing", detail: "Review pending and excluded contacts in the list's processing results." },
    { key: "missingContent", count: result.missingContent, label: "Personalized emails needed", detail: "Run lead processing with email writing enabled before enrolling these contacts." },
    { key: "leadsWithoutContact", count: result.leadsWithoutContact, label: "No linked CRM contact", detail: "Link these leads to CRM contacts before enrolling." },
  ].filter((reason) => reason.count > 0);
}

/** Older responses omit counts that did not apply; treat those as zero. */
export function normalizeEmailEnrollmentResult(data: unknown): EmailEnrollmentResult {
  const source = data && typeof data === "object" ? data as Record<string, unknown> : {};
  const count = (key: keyof EmailEnrollmentResult): number => {
    const value = source[key];
    return typeof value === "number" && Number.isFinite(value)
      ? Math.max(0, Math.trunc(value))
      : 0;
  };
  return {
    enrolled: count("enrolled"),
    skipped: count("skipped"),
    noEmail: count("noEmail"),
    suppressed: count("suppressed"),
    alreadyInAnotherSequence: count("alreadyInAnotherSequence"),
    filteredOut: count("filteredOut"),
    awaitingPipeline: count("awaitingPipeline"),
    missingContent: count("missingContent"),
    leadsWithoutContact: count("leadsWithoutContact"),
    moved: count("moved"),
  };
}

/** Shared by the enrollment toast and dialog so zero enrollment stays explainable. */
export function describeEmailEnrollmentResult(result: EmailEnrollmentResult): EmailEnrollmentOutcome {
  const reasons: string[] = [];
  const actions: string[] = [];
  const reason = (count: number, text: string, action?: string) => {
    if (count <= 0) return;
    reasons.push(`${count.toLocaleString()} ${text}`);
    if (action) actions.push(action);
  };

  // Early filter/pipeline responses also include their rejected count in skipped.
  // Only the remainder represents duplicate enrollments in this sequence.
  const alreadyEnrolled = Math.max(0, result.skipped - result.filteredOut - result.awaitingPipeline);
  reason(alreadyEnrolled, "already enrolled in this sequence");
  reason(result.alreadyInAnotherSequence, "active in another sequence", "Review their existing sequence before enrolling them here.");
  reason(result.noEmail, "missing an email address", "Add email addresses to those contacts.");
  reason(result.suppressed, "suppressed (unsubscribed, do not contact, or bounced)");
  reason(result.filteredOut, "excluded by this sequence's enrollment filter", "Review the sequence's enrollment filter.");
  reason(result.awaitingPipeline, "not yet approved by lead processing", "Review the list's processing results and pending leads.");
  reason(result.missingContent, "missing generated email content", "Run lead processing with email writing enabled for this sequence.");
  reason(result.leadsWithoutContact, "without a linked CRM contact", "Link those leads to CRM contacts.");

  const details = reasons.length > 0 ? `Not enrolled: ${reasons.join("; ")}.` : "";
  const moved = result.moved > 0 ? `${result.moved.toLocaleString()} moved from the source sequence.` : "";
  if (result.enrolled > 0) {
    return {
      tone: "success",
      title: `${result.enrolled.toLocaleString()} lead${result.enrolled === 1 ? "" : "s"} enrolled in sequence`,
      description: [details, moved].filter(Boolean).join(" "),
    };
  }
  if (reasons.length > 0) {
    return {
      tone: "warning",
      title: "No leads enrolled",
      description: [details, ...actions].join(" "),
    };
  }
  return {
    tone: "neutral",
    title: "No contacts found to enroll",
    description: "The selected lists contain no matching contacts. Review their members or smart list filters.",
  };
}
