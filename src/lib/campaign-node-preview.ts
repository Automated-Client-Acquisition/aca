/** Labels shared by editable cards and their connections. */
export function campaignNodeDisplayLabel(data: { customLabel?: string; label?: string }, configuredLabel: string | undefined, dynamicLabel: string, suppliedLabel?: string) {
  return data.customLabel || (data.label && data.label !== configuredLabel ? data.label : undefined) || (suppliedLabel !== configuredLabel ? suppliedLabel : undefined) || dynamicLabel;
}

export function campaignBranchLabel(handle?: string | null): string {
  const labels: Record<string, string> = {
    default: "Continue",
    accepted: "Connected",
    notAccepted: "Not connected",
    replied: "Replied",
    noReply: "No reply",
    available: "Available",
    notAvailable: "Unavailable",
    hasWhatsapp: "On WhatsApp",
    noWhatsapp: "No WhatsApp",
    opened: "Opened",
    notOpened: "Not opened",
    clicked: "Clicked",
    notClicked: "Not clicked",
    enriched: "Enriched",
    notEnriched: "Not enriched",
    analyzed: "Analyzed",
    notAnalyzed: "Not analyzed",
    clean: "Valid email",
    risky: "Risky email",
    failed: "Invalid email",
    pass: "Meets threshold",
    fail: "Below threshold",
    open: "Open profile",
    notOpen: "Regular profile",
    closed: "Regular profile",
    interested: "Interested",
    meeting_booked: "Meeting booked",
    not_interested: "Not interested",
    out_of_office: "Out of office",
    auto_reply: "Auto reply",
    neutral: "Neutral",
    no_reply: "No reply",
    // Route by Channel
    linkedin: "LinkedIn",
    email: "Email",
    instagram: "Instagram",
    whatsapp: "WhatsApp",
    telegram: "Telegram",
    none: "No channel",
  };
  if (!handle) return labels.default;
  return (
    labels[handle] ||
    handle.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ")
  );
}

/** Visual semantics follow the route handle, never arbitrary custom copy. */
export function campaignBranchTone(handle?: string | null): "positive" | "negative" | "neutral" {
  if (["accepted", "replied", "available", "hasWhatsapp", "opened", "clicked", "enriched", "analyzed", "clean", "pass", "open", "interested", "meeting_booked"].includes(handle || "")) return "positive";
  if (["notAccepted", "notAvailable", "noWhatsapp", "notOpened", "notClicked", "notEnriched", "notAnalyzed", "failed", "fail", "not_interested", "none"].includes(handle || "")) return "negative";
  return "neutral";
}

/** Summarize configured copy, counting only nonempty variants. Never generate or send copy. */
export function campaignNodeCopyPreview(data: {
  messageMode?: string;
  emailMode?: string;
  sequenceMode?: string;
  message?: string;
  body?: string;
  emailBody?: string;
  prompt?: string;
  emailPrompt?: string;
  subject?: string;
  emailSubject?: string;
  messageVariations?: (string | { subject?: string; message?: string })[];
  bodyVariations?: string[];
  promptVariations?: string[];
  subjectVariations?: string[];
}) {
  const isPrompt = [
    data.messageMode,
    data.emailMode,
    data.sequenceMode,
  ].includes("prompt");
  const original = isPrompt
    ? data.prompt || data.emailPrompt
    : data.message || data.body || data.emailBody;
  const variants = (
    isPrompt
      ? data.promptVariations || []
      : [...(data.messageVariations || []), ...(data.bodyVariations || [])]
  ).filter((value) =>
    typeof value === "string" ? !!value.trim() : !!value?.message?.trim(),
  );
  const first = variants[0];
  const content = original?.trim()
    ? original
    : typeof first === "string"
      ? first
      : first?.message;
  const count = (original?.trim() ? 1 : 0) + variants.length;
  const subject =
    data.subject ||
    data.emailSubject ||
    data.subjectVariations?.find((value) => !!value?.trim()) ||
    (typeof first === "object" ? first?.subject : undefined);
  return {
    isPrompt,
    count,
    subject,
    content: content
      ?.replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
    summary:
      count > 1
        ? `${isPrompt ? "AI · " : ""}${count} variants`
        : content
          ? isPrompt
            ? "AI personalized"
            : "Manual message"
          : isPrompt
            ? "Add an AI prompt"
            : "Add message content",
  };
}

/** Manual InMail sends the primary subject/body; retained objects are not A/B routes. */
export function campaignInMailCopyPreview(data: Parameters<typeof campaignNodeCopyPreview>[0]) {
  const retained = data.messageMode !== "prompt" && (data.messageVariations || []).some(value => typeof value === "object" && !!value.message?.trim());
  const needsPrimaryMessage = retained && !data.message?.trim();
  return {
    ...campaignNodeCopyPreview(data.messageMode === "prompt" || needsPrimaryMessage ? data : { ...data, messageVariations: [] }),
    needsPrimaryMessage,
  };
}
