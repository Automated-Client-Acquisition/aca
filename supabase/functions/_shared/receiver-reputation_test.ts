import {
  receiverProvider,
  summarizeReceiverReputation,
  type ReputationTrace,
} from "./receiver-reputation.ts";

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

Deno.test("receiver scope uses consumer recipient domains and verified MX facts", () => {
  const mx = new Map([["business.test", "google"], ["enterprise.test", "microsoft"], ["mail.test", "other"]]);
  equal(receiverProvider("Person@GMAIL.COM", mx), "google");
  equal(receiverProvider("person@outlook.com", mx), "microsoft");
  equal(receiverProvider("person@business.test", mx), "google");
  equal(receiverProvider("person@enterprise.test", mx), "microsoft");
  equal(receiverProvider("person@mail.test", mx), "other");
  equal(receiverProvider("person@unverified-custom.test", mx), "unknown");
  equal(receiverProvider(null, mx), "unknown");
});

Deno.test("provider rejection shares use matching confirmed recipients without dilution", () => {
  const row = (recipient: string, status = "Delivered", category: string | null = null): ReputationTrace => ({
    recipient_email: recipient, trace_status: status, error_category: category,
    error_message: category ? "receiver refusal" : null,
  });
  const summaries = summarizeReceiverReputation([
    row("blocked@gmail.com", "Failed", "reputation_block"),
    row("ok@gmail.com"),
    row("a@outlook.com"), row("b@outlook.com"), row("c@outlook.com"),
    row("unknown@custom.test", "Failed", "reputation_block"),
    row("pending@gmail.com", "Pending", "reputation_block"),
    row("not-traced@gmail.com", "no_trace", "reputation_block"),
  ]);
  equal(summaries.map(({ provider, reconciledCount, blockCount }) => ({ provider, reconciledCount, blockCount })), [
    { provider: "google", reconciledCount: 2, blockCount: 1 },
    { provider: "microsoft", reconciledCount: 3, blockCount: 0 },
    { provider: "unknown", reconciledCount: 1, blockCount: 1 },
  ]);
});

Deno.test("Google Workspace evidence uses the same scope for accepted and blocked mail", () => {
  const summaries = summarizeReceiverReputation([
    { recipient_email: "person@workspace.test", trace_status: "Failed", error_category: "reputation_block", error_message: "550" },
    { recipient_email: "person@gmail.com", trace_status: "Delivered", error_category: null, error_message: null },
  ], new Map([["workspace.test", "google"]]));
  equal(summaries.length, 1);
  equal(summaries[0].reconciledCount, 2);
  equal(summaries[0].blockCount, 1);
});
