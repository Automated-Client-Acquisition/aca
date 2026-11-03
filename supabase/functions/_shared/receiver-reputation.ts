/** Receiver scope comes from the recipient address or previously verified MX
 * facts, never the sender's provider or the wording of an SMTP rejection. */
export type ReceiverProvider = "google" | "microsoft" | "other" | "unknown";

const GOOGLE_CONSUMER_DOMAINS = new Set(["gmail.com", "googlemail.com"]);
const MICROSOFT_CONSUMER_DOMAINS = new Set([
  "outlook.com", "hotmail.com", "live.com", "msn.com",
]);

export function recipientDomain(email: string | null): string {
  return (email ?? "").trim().toLowerCase().split("@")[1] ?? "";
}

export function receiverProvider(
  email: string | null,
  knownMx: ReadonlyMap<string, string> = new Map(),
): ReceiverProvider {
  const domain = recipientDomain(email);
  if (GOOGLE_CONSUMER_DOMAINS.has(domain)) return "google";
  if (MICROSOFT_CONSUMER_DOMAINS.has(domain)) return "microsoft";
  const provider = knownMx.get(domain);
  return provider === "google" || provider === "microsoft" || provider === "other"
    ? provider
    : "unknown";
}

export interface ReputationTrace {
  recipient_email: string | null;
  trace_status: string | null;
  error_category: string | null;
  error_message: string | null;
}

export interface ReceiverReputationSummary {
  provider: ReceiverProvider;
  reconciledCount: number;
  blockCount: number;
  sample: string;
}

/** Numerator and denominator always use the same confirmed provider rows. */
export function summarizeReceiverReputation(
  rows: readonly ReputationTrace[],
  knownMx: ReadonlyMap<string, string> = new Map(),
): ReceiverReputationSummary[] {
  const summaries = new Map<ReceiverProvider, ReceiverReputationSummary>();
  for (const row of rows) {
    if (!["Delivered", "Failed", "Quarantined", "FilteredAsSpam"].includes(row.trace_status ?? "")) continue;
    const provider = receiverProvider(row.recipient_email, knownMx);
    const summary = summaries.get(provider) ?? {
      provider, reconciledCount: 0, blockCount: 0, sample: "n/a",
    };
    summary.reconciledCount++;
    if (row.error_category === "reputation_block") {
      summary.blockCount++;
      if (summary.sample === "n/a") summary.sample = row.error_message ?? "n/a";
    }
    summaries.set(provider, summary);
  }
  return [...summaries.values()];
}

export function receiverScopeLabel(provider: ReceiverProvider): string {
  if (provider === "google") return "Google recipients (Gmail / known Google MX)";
  if (provider === "microsoft") return "Microsoft recipients (consumer / known Microsoft MX)";
  if (provider === "other") return "recipients with other known MX providers";
  return "recipients with unknown providers (custom domains without known MX)";
}
