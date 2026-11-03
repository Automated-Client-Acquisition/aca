import { ALL_MESSAGE_VARIABLES } from "@/lib/message-variables";

export interface EmailPreviewSender {
  signature?: string | null;
  senderName?: string | null;
  senderFirstName?: string | null;
  senderLastName?: string | null;
}

export interface EmailPreviewVariables {
  values: Record<string, string>;
  htmlValues: Set<string>;
}

interface EmailPreviewInput {
  contact: object | null | undefined;
  lead?: object | null;
  customData?: Record<string, unknown> | null;
  sender?: EmailPreviewSender | null;
  defaults?: Record<string, string>;
  customFieldDefaults?: Record<string, string>;
  productVariables?: Record<string, string>;
}

const aliases: Record<string, string> = {
  firstName: "first_name", lastName: "last_name", fullName: "full_name",
  companyName: "company", company_name: "company", jobTitle: "job_title",
  title: "job_title", position: "job_title", senderName: "sender_name",
  senderFirstName: "sender_first_name", senderLastName: "sender_last_name",
  aiLinkedInTopic1: "ai_linkedin_topic_1",
};

function scalar(value: unknown): string | undefined {
  return ["string", "number", "boolean"].includes(typeof value) && value !== ""
    ? String(value) : undefined;
}

function nested(data: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) =>
    value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined, data);
}

/** Build send-time values without inserting fabricated contact data. */
export function buildEmailPreviewVariables({
  contact, lead, customData, sender, defaults, customFieldDefaults, productVariables,
}: EmailPreviewInput): EmailPreviewVariables {
  const person = (contact || {}) as Record<string, unknown>;
  const leadData = (lead || {}) as Record<string, unknown>;
  const values: Record<string, string> = {};
  const htmlValues = new Set<string>();
  const put = (key: string, value: unknown) => {
    const text = scalar(value);
    if (text !== undefined) values[key] = text;
  };
  Object.entries(customFieldDefaults || {}).forEach(([key, value]) => put(`custom_${key}`, value));
  Object.entries(defaults || {}).forEach(([key, value]) => put(key, value));
  Object.entries(person).forEach(([key, value]) => put(key, value));
  Object.entries(leadData).forEach(([key, value]) => put(key, value));
  const source = { ...person, ...Object.fromEntries(Object.entries(leadData).filter(([, value]) => scalar(value) !== undefined)) };
  put("email", source.email || person.primary_email);
  put("full_name", [source.first_name, source.last_name].filter(Boolean).join(" ") || person.full_name || person.display_name);
  put("website", person.company_website);
  put("location", person.city || [person.city, person.state, person.country].filter(Boolean).join(", "));
  const enrichment = (person.enrichment_data || {}) as Record<string, unknown>;
  const discovery = (person.discovery_metadata || {}) as Record<string, unknown>;
  put("industry", enrichment.industry || person.industry);
  put("headline", enrichment.headline || person.job_title);
  for (const variable of ALL_MESSAGE_VARIABLES) {
    if (variable.sender) continue;
    const name = variable.key.slice(2, -2);
    if (variable.aiField) put(name, nested(enrichment, variable.aiField));
    else if (variable.signalField) put(name, discovery[variable.signalField]);
    else put(name, source[variable.field]);
  }
  put("ai_signal_source_url", discovery.signal_source_url || discovery.directory_evidence_url);
  put("ai_signal_company_size", discovery.ai_signal_company_size || discovery.company_employee_range);
  put("ai_signal_revenue", discovery.ai_signal_revenue || discovery.company_revenue_range);
  const customFields = (person.custom_fields || {}) as Record<string, unknown>;
  Object.entries(customFields).forEach(([key, value]) => put(`custom_${key}`, value));
  Object.entries(productVariables || {}).forEach(([key, value]) => put(key, value));
  // Sender's custom_ fallback and generated-email aliases share the same value.
  const customNames = new Set<string>();
  for (const key of Object.keys(customData || {})) {
    customNames.add(key);
    if (key.startsWith("custom_")) customNames.add(key.slice(7));
    const email = key.match(/^custom_email_(\d+)_(subject|body)$/);
    if (email) customNames.add(`email_${email[2]}_${email[1]}`);
  }
  const enrollmentValue = (name: string): string | undefined => {
    const generated = name.match(/^email_(subject|body)_(\d+)$/);
    return scalar(customData?.[name]) ?? scalar(customData?.[`custom_${name}`])
      ?? (generated ? scalar(customData?.[`custom_email_${generated[2]}_${generated[1]}`]) : undefined);
  };
  for (const name of customNames) {
    const value = enrollmentValue(name);
    if (value === undefined) continue;
    put(name, value);
    if (/^(?:custom_)?email_(?:body_\d+|\d+_body)$/.test(name)) htmlValues.add(name);
  }
  // Mailbox variables never fall back to contact or enrollment values.
  for (const [name, value] of Object.entries({
    signature: sender?.signature,
    sender_name: sender?.senderName,
    sender_first_name: sender?.senderFirstName,
    sender_last_name: sender?.senderLastName,
  })) {
    delete values[name];
    put(name, value);
  }
  htmlValues.add("signature");
  const allAliases = { ...aliases };
  for (const variable of ALL_MESSAGE_VARIABLES) {
    const name = variable.key.slice(2, -2);
    if (name.startsWith("ai_")) allAliases[name.replace(/_([a-z0-9])/g, (_, char: string) => char.toUpperCase())] = name;
  }
  for (const [alias, canonical] of Object.entries(allAliases)) {
    if (canonical.startsWith("sender_")) {
      delete values[alias];
      if (values[canonical] !== undefined) values[alias] = values[canonical];
    } else if (values[canonical] !== undefined && enrollmentValue(alias) === undefined) {
      values[alias] = values[canonical];
    }
    if (htmlValues.has(canonical)) htmlValues.add(alias);
  }
  return { values, htmlValues };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

/** Preserve missing values so an author can fix them before sending. */
export function resolveEmailPreview(
  template: string, variables: EmailPreviewVariables, seed: string, isHtml = false,
): { text: string; missing: string[]; deferred: string[] } {
  const missing = new Set<string>();
  const deferred = new Set<string>();
  const unwrapped = template.replace(
    /<span\b(?=[^>]*\bdata-(?:variable|spintax)-token\s*=)([^>]*)>[\s\S]*?<\/span>/gi,
    (_match, attributes: string) => attributes.match(/\bdata-(?:variable|spintax)-token\s*=\s*(["'])(.*?)\1/i)?.[2] || "",
  );
  const resolve = (text: string, html: boolean, stack: string[]): string => text.replace(
    /\{\{\s*(\w+)\s*\}\}/g,
    (token, name: string) => {
      if (["unsubscribe_link", "unsubscribeLink"].includes(name)) {
        deferred.add("unsubscribe_link");
        return "{{unsubscribe_link}}";
      }
      // Repair sender near-misses in AI-written bodies as the sender worker does.
      const canonical = /^sender_first[a-z_]*$/i.test(name) ? "sender_first_name"
        : /^sender_last[a-z_]*$/i.test(name) ? "sender_last_name" : name;
      const value = variables.values[canonical];
      if (value === undefined || value === "" || stack.includes(canonical) || stack.length >= 8) {
        missing.add(name);
        return token;
      }
      if (html && variables.htmlValues.has(canonical)) return resolve(value, true, [...stack, canonical]);
      const resolved = resolve(value, false, [...stack, canonical]);
      return html ? escapeHtml(resolved) : resolved;
    },
  );
  let group = 0;
  const text = resolve(unwrapped, isHtml, []).replace(/\{([^{}]*\|[^{}]*)\}/g, (_, body: string) => {
    const options = body.split("|");
    let hash = 0;
    for (const char of `${seed}#${group++}`) hash = (hash * 31 + char.charCodeAt(0)) | 0;
    return options[Math.abs(hash) % options.length];
  });
  return { text, missing: [...missing], deferred: [...deferred] };
}
