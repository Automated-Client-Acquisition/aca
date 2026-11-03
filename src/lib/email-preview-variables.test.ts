import test from "node:test";
import assert from "node:assert/strict";
import { buildEmailPreviewVariables, resolveEmailPreview } from "@/lib/email-preview-variables";

test("real contact, enrichment and signals replace aliases with no sample content", () => {
  const vars = buildEmailPreviewVariables({
    contact: { first_name: "Ana", last_name: "Lee", primary_email: "ana@example.com", company: "Actual Co", company_website: "https://actual.test", enrichment_data: { primary_need: "Grow sales", linkedin_topics: ["CRM"] }, discovery_metadata: { signal_outreach_context: "New funding", company_employee_range: "51–200" } },
    defaults: { firstName: "Fallback" },
  });
  const result = resolveEmailPreview("{{firstName}} {{full_name}} {{email}} {{website}} {{aiPrimaryNeed}} {{aiLinkedInTopic1}} {{ai_signal_context}} {{ai_signal_company_size}}", vars, "contact");
  assert.equal(result.text, "Ana Ana Lee ana@example.com https://actual.test Grow sales CRM New funding 51–200");
  assert.deepEqual(result.missing, []);
});

test("enrollment copy wins over contact/defaults and resolves nested sender near-misses", () => {
  const vars = buildEmailPreviewVariables({
    contact: { first_name: "Ana", company: "CRM Co", custom_fields: { intro: "Contact intro" } },
    customData: { company: "Enrollment Co", custom_intro: "Enrollment intro", custom_email_1_subject: "Hello {{first_name}}", custom_email_1_body: "Sent by {{sender_first_}} {{sender_last_name}}" },
    sender: { senderFirstName: "Maya", senderLastName: "Jones" }, defaults: { company: "Fallback" },
  });
  assert.equal(resolveEmailPreview("{{email_subject_1}} / {{custom_email_1_body}} / {{company}} / {{custom_intro}}", vars, "contact").text, "Hello Ana / Sent by Maya Jones / Enrollment Co / Enrollment intro");
});

test("blank overrides do not erase real fields; zero and false are valid values", () => {
  const vars = buildEmailPreviewVariables({ contact: { first_name: "", company: "Actual", custom_fields: { score: 0, enabled: false } }, customData: { company: "" }, defaults: { first_name: "there" }, customFieldDefaults: { score: "10", missing: "Org fallback" } });
  assert.equal(resolveEmailPreview("{{first_name}} {{company}} {{custom_score}} {{custom_enabled}} {{custom_missing}}", vars, "s").text, "there Actual 0 false Org fallback");
});

test("HTML values are escaped while signature and generated body retain markup", () => {
  const vars = buildEmailPreviewVariables({ contact: { first_name: '<img src=x onerror="attack()">' }, sender: { signature: "<strong>Maya</strong>" }, customData: { custom_email_1_body: "<p>Hi {{first_name}}</p>" } });
  const result = resolveEmailPreview('<p>{{first_name}}</p>{{email_body_1}}{{signature}}', vars, "s", true);
  assert.equal(result.text, '<p>&lt;img src=x onerror=&quot;attack()&quot;&gt;</p><p>Hi &lt;img src=x onerror=&quot;attack()&quot;&gt;</p><strong>Maya</strong>');
});

test("legacy chips resolve once, missing variables remain visible and unsubscribe is deferred", () => {
  const vars = buildEmailPreviewVariables({ contact: {}, sender: { signature: "<b>Maya</b>" } });
  const result = resolveEmailPreview('<span data-variable-token="{{signature}}">{{signature}}</span>{{unknown}} {{unknown}} {{unsubscribeLink}}', vars, "s", true);
  assert.equal(result.text, "<b>Maya</b>{{unknown}} {{unknown}} {{unsubscribe_link}}");
  assert.deepEqual(result.missing, ["unknown"]);
  assert.deepEqual(result.deferred, ["unsubscribe_link"]);
});

test("spintax from generated content is stable for one preview seed", () => {
  const vars = buildEmailPreviewVariables({ contact: {}, customData: { custom_email_1_body: "{Hello|Hi|Hey} {one|two|three}" } });
  const first = resolveEmailPreview("{{email_body_1}}", vars, "contact:step").text;
  assert.equal(resolveEmailPreview("{{email_body_1}}", vars, "contact:step").text, first);
  assert.doesNotMatch(first, /[{}|]/);
  const variations = new Set(Array.from({ length: 12 }, (_, index) => resolveEmailPreview("{{email_body_1}}", vars, `contact:step:${index}`).text));
  assert.ok(variations.size > 1);
});

test("cyclic generated tokens stop resolving and report the missing token", () => {
  const result = resolveEmailPreview("{{custom_loop}}", buildEmailPreviewVariables({ contact: {}, customData: { custom_loop: "{{custom_loop}}" } }), "s");
  assert.equal(result.text, "{{custom_loop}}");
  assert.deepEqual(result.missing, ["custom_loop"]);
});

test("sender data cannot be replaced by contact, enrollment or sequence defaults", () => {
  const vars = buildEmailPreviewVariables({ contact: { sender_first_name: "Contact" }, customData: { senderFirstName: "Enrollment" }, defaults: { sender_first_name: "Fallback" }, sender: { senderFirstName: "Mailbox" } });
  assert.equal(resolveEmailPreview("{{sender_first_name}} {{senderFirstName}}", vars, "s").text, "Mailbox Mailbox");
  const missing = resolveEmailPreview("{{senderFirstName}}", buildEmailPreviewVariables({ contact: {}, defaults: { senderFirstName: "Fake sender" } }), "s");
  assert.deepEqual(missing.missing, ["senderFirstName"]);
});

test("sequence custom-field fallbacks override organization fallbacks, while contact data wins", () => {
  const fallback = buildEmailPreviewVariables({ contact: {}, customFieldDefaults: { segment: "Organization" }, defaults: { custom_segment: "Sequence" } });
  assert.equal(resolveEmailPreview("{{custom_segment}}", fallback, "s").text, "Sequence");
  const actual = buildEmailPreviewVariables({ contact: { custom_fields: { segment: "Actual" } }, customFieldDefaults: { segment: "Organization" }, defaults: { custom_segment: "Sequence" } });
  assert.equal(resolveEmailPreview("{{custom_segment}}", actual, "s").text, "Actual");
});

test("enrollment direct names beat custom_ and generated aliases regardless of insertion order", () => {
  const entries = { company: "Direct", custom_company: "Prefixed", email_body_1: "Direct body", custom_email_body_1: "Prefixed body", custom_email_1_body: "Remapped body", custom_firstName: "Enrollment name" };
  for (const customData of [entries, Object.fromEntries(Object.entries(entries).reverse())]) {
    const vars = buildEmailPreviewVariables({ contact: { company: "Contact", first_name: "Contact name" }, customData });
    assert.equal(resolveEmailPreview("{{company}} {{email_body_1}} {{firstName}}", vars, "s").text, "Direct Direct body Enrollment name");
  }
  const prefixed = buildEmailPreviewVariables({ contact: {}, customData: { custom_email_body_1: "Prefixed body", custom_email_1_body: "Remapped body" } });
  assert.equal(resolveEmailPreview("{{email_body_1}}", prefixed, "s").text, "Prefixed body");
});
