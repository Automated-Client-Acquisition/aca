export const ENTRY_TYPES = [
  "connection_request",
  "message_received",
  "post_comment",
  "keyword_match",
  "signal",
  "list_member_added",
  "integration_event",
] as const;
export type CampaignEntryType = (typeof ENTRY_TYPES)[number];

export interface CampaignEntryRule {
  createdAt?: string;
  id: string;
  name: string;
  type: CampaignEntryType;
  enabled: boolean;
  accountIds: string[];
  channel: string;
  keywords: string[];
  keywordSource: "messages" | "comments" | "integration";
  postIds: string[];
  signalTypes: string[];
  listIds: string[];
  eventName: string;
  qualification: { enabled: boolean; productId: string; minScore: number };
  onMatch: "enroll" | "accept_and_enroll" | "review";
  onMismatch: "ignore" | "decline";
}

export const ENTRY_CATALOG: Record<
  CampaignEntryType,
  { title: string; description: string; source: string }
> = {
  connection_request: {
    title: "Connection request",
    description: "Qualify an incoming LinkedIn invitation before deciding.",
    source: "LinkedIn · polled",
  },
  message_received: {
    title: "Incoming message",
    description: "Start a sequence when someone reaches out.",
    source: "Connected inbox · event",
  },
  post_comment: {
    title: "Post comment",
    description:
      "Turn relevant comments on selected posts into qualified leads.",
    source: "LinkedIn · polled",
  },
  keyword_match: {
    title: "Keyword match",
    description:
      "Capture intent in messages, comments, or a connected monitor.",
    source: "Captured content or connected app",
  },
  signal: {
    title: "Buying signal",
    description: "Enter when a person is added by the signal engine.",
    source: "ACA signal engine · event",
  },
  list_member_added: {
    title: "Added to a list",
    description: "Start a sequence when a person joins a selected lead list.",
    source: "ACA lead lists · event",
  },
  integration_event: {
    title: "n8n / GHL event",
    description:
      "Let your existing workflow deliver the right person and event.",
    source: "Connected app · event",
  },
};

export function createEntryRule(
  type: CampaignEntryType,
  productId = "",
): CampaignEntryRule {
  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    name: ENTRY_CATALOG[type].title,
    type,
    enabled: true,
    accountIds: [],
    channel:
      type === "connection_request" || type === "post_comment"
        ? "linkedin"
        : "any",
    keywords: [],
    keywordSource: "messages",
    postIds: [],
    signalTypes: [],
    listIds: [],
    eventName: "",
    qualification: { enabled: true, productId, minScore: 70 },
    onMatch: type === "connection_request" ? "accept_and_enroll" : "enroll",
    onMismatch: "ignore",
  };
}

export function splitEntryValues(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[\n,]+/)
        .map((part) => part.trim())
        .filter(Boolean),
    ),
  ];
}

export function normalizeEntryPost(value: string): string {
  if (/^\d+$/.test(value.trim())) return `urn:li:activity:${value.trim()}`;
  const match = value.match(/(activity|ugcPost)[-:](\d+)/i);
  return match
    ? `urn:li:${match[1].toLowerCase() === "ugcpost" ? "ugcPost" : "activity"}:${match[2]}`
    : value.trim();
}

/** Older campaigns have no entry rules. Never enable them during hydration. */
export function normalizeEntryRules(value: unknown): CampaignEntryRule[] {
  if (!Array.isArray(value)) return [];
  const strings = (input: unknown): string[] =>
    Array.isArray(input)
      ? input.filter((part): part is string => typeof part === "string")
      : [];
  return value
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      ...item,
      id: typeof item.id === "string" ? item.id : "",
      name: typeof item.name === "string" ? item.name : "Untitled trigger",
      type: item.type,
      enabled: item.enabled === true,
      accountIds: strings(item.accountIds),
      channel: typeof item.channel === "string" ? item.channel : "any",
      keywords: strings(item.keywords),
      keywordSource: item.keywordSource ?? "messages",
      postIds: strings(item.postIds),
      signalTypes: strings(item.signalTypes),
      listIds: strings(item.listIds),
      eventName: item.eventName ?? "",
      qualification: {
        enabled: item.qualification?.enabled !== false,
        productId: item.qualification?.productId ?? "",
        minScore: item.qualification?.minScore ?? 70,
      },
      onMatch: item.onMatch ?? "review",
      onMismatch: item.onMismatch ?? "ignore",
    }));
}

export function entryRuleErrors(rule: CampaignEntryRule): string[] {
  const errors: string[] = [];
  if (!rule.id || !rule.name.trim()) errors.push("Give this trigger a name.");
  if (!ENTRY_TYPES.includes(rule.type))
    errors.push("This trigger type is no longer supported.");
  if (!["any", "linkedin", "email", "whatsapp", "instagram", "telegram", "sms"].includes(rule.channel)) errors.push("Choose a supported channel.");
  if (rule.type === "keyword_match" && !["messages", "comments", "integration"].includes(rule.keywordSource)) errors.push("Choose where keywords are monitored.");
  if ([rule.accountIds, rule.keywords, rule.postIds, rule.signalTypes, rule.listIds ?? []].some(values => values.length > 100 || values.some(value => value.length > 1000))) errors.push("Use at most 100 filters, each under 1,000 characters.");
  if (rule.type === "list_member_added") {
    if (!rule.listIds?.length) errors.push("Choose at least one lead list.");
    if (rule.listIds?.some(id => !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))) errors.push("Choose valid lead lists.");
    if (rule.channel !== "any" || rule.accountIds.length) errors.push("List additions do not use receiving accounts or channel filters.");
  }
  if (rule.postIds.length > 20) errors.push("Watch at most 20 LinkedIn posts per trigger.");
  const native =
    ["connection_request", "message_received", "post_comment"].includes(
      rule.type,
    ) ||
    (rule.type === "keyword_match" && rule.keywordSource !== "integration");
  if (native && !rule.accountIds.length)
    errors.push("Choose at least one connected account.");
  if (
    (rule.type === "post_comment" ||
      (rule.type === "keyword_match" && rule.keywordSource === "comments")) &&
    !rule.postIds.length
  )
    errors.push("Add at least one LinkedIn post to monitor.");
  if (rule.type === "keyword_match" && !rule.keywords.length)
    errors.push("Add at least one keyword or phrase.");
  if (rule.type === "integration_event" && !rule.eventName.trim())
    errors.push("Enter the event name your workflow will send.");
  if (rule.qualification.enabled) {
    if (!rule.qualification.productId)
      errors.push("Choose a product for ICP verification.");
    if (
      !Number.isFinite(rule.qualification.minScore) ||
      rule.qualification.minScore < 0 ||
      rule.qualification.minScore > 100
    )
      errors.push("ICP threshold must be between 0 and 100.");
  }
  if (
    rule.type !== "connection_request" &&
    (rule.onMatch === "accept_and_enroll" || rule.onMismatch === "decline")
  )
    errors.push(
      "Invitation decisions are only available for connection requests.",
    );
  if (rule.type === "connection_request" && !rule.qualification.enabled)
    errors.push("Connection decisions require ICP verification.");
  return errors;
}

export function entryRulesErrors(rules: CampaignEntryRule[]): string[] {
  const active = rules.filter((rule) => rule.enabled);
  const errors = active.flatMap((rule) =>
    entryRuleErrors(rule).map((error) => `${rule.name || "Trigger"}: ${error}`),
  );
  if (rules.length > 20) errors.unshift("Use no more than 20 entry triggers per campaign.");
  if (new Set(rules.map(rule => rule.id)).size !== rules.length) errors.push("Each trigger must have a unique identity.");
  return errors;
}

export function entryAccountErrors(rules: CampaignEntryRule[], senderIds: string[], accounts?: { id: string; status: string }[]): string[] {
  return rules.filter(rule => rule.enabled).flatMap(rule => {
    const native = ["connection_request", "message_received", "post_comment"].includes(rule.type) || rule.type === "keyword_match" && rule.keywordSource !== "integration";
    if (!native) return [];
    const errors = [];
    if (rule.accountIds.some(id => !senderIds.includes(id))) errors.push(`${rule.name}: receiving accounts must also be campaign senders.`);
    if (accounts && rule.accountIds.some(id => !accounts.some(account => account.id === id && account.status === "active"))) errors.push(`${rule.name}: a receiving account is unavailable or disconnected.`);
    return errors;
  });
}

export function entryRuleSummary(rule: CampaignEntryRule): string {
  const fit = rule.qualification.enabled
    ? `ICP ≥ ${rule.qualification.minScore}`
    : "No ICP gate";
  const outcome =
    rule.onMatch === "review"
      ? "Review"
      : rule.onMatch === "accept_and_enroll"
        ? "Accept & enroll"
        : "Enroll";
  const source = rule.type === "list_member_added"
    ? `${rule.listIds?.length ?? 0} list${rule.listIds?.length === 1 ? "" : "s"} · `
    : "";
  return `${source}${fit} · ${outcome}`;
}

export function entryKeywordMatches(text: string, keywords: string[]): boolean {
  const normalized = text.normalize("NFKC").toLocaleLowerCase();
  const wordCharacter = /[\p{L}\p{N}_]/u;
  return keywords.some(word => {
    const phrase = word.trim().normalize("NFKC").toLocaleLowerCase();
    if (!phrase) return false;
    let offset = normalized.indexOf(phrase);
    while (offset !== -1) {
      const before = normalized[offset - 1] || "";
      const after = normalized[offset + phrase.length] || "";
      if ((!wordCharacter.test(phrase[0]) || !wordCharacter.test(before)) && (!wordCharacter.test(phrase[phrase.length - 1]) || !wordCharacter.test(after))) return true;
      offset = normalized.indexOf(phrase, offset + 1);
    }
    return false;
  });
}

export function previewEntryDecision(
  rule: CampaignEntryRule,
  text: string,
  score: number | null,
): string {
  if (!rule.enabled) return "Paused — this trigger will not run.";
  if (rule.keywords.length && !entryKeywordMatches(text, rule.keywords))
    return "No keyword match — event skipped.";
  if (
    rule.qualification.enabled &&
    (score == null || !Number.isFinite(score) || score < 0 || score > 100)
  )
    return "Needs review — ICP information is missing.";
  if (rule.qualification.enabled && score! < rule.qualification.minScore)
    return rule.onMismatch === "decline"
      ? "Below threshold — decline the invitation."
      : "Below threshold — leave out of this campaign.";
  if (rule.onMatch === "review")
    return "Qualified — send to review before enrollment.";
  return rule.onMatch === "accept_and_enroll"
    ? "Qualified — accept the invitation and enroll."
    : "Qualified — enroll in this campaign.";
}
