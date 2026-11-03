// Auto-detects which target field each CSV header should map to.
//
// Two passes, so precise matches always beat fuzzy ones:
//   1. Exact alias: the normalized header equals a known alias ("Job Title" -> job_title).
//   2. Token rules: the header's words contain a set of keywords ("Company Industry" -> industry).
// Each target field is assigned to at most one column (first match wins), so a file with
// "Email" and "Email Address" maps one of them and skips the other instead of fighting over it.

export interface AutoFieldMapping {
  csvColumn: string;
  targetField: string;
}

// Lowercase words, no accents, "E-mail" -> "email", "Catch-all" -> "catchall",
// camelCase split ("EmailStatus" -> "email status"). Used for both aliases and headers.
function tokenize(text: string): string[] {
  const cleaned = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\be[\s._-]?mail\b/gi, "email")
    .replace(/\bcatch[\s._-]?all\b/gi, "catchall")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase();
  return cleaned.split(/[^a-z0-9]+/).filter(Boolean);
}

const compact = (text: string) => tokenize(text).join("");

// Aliases are written in plain words; they are compacted the same way headers are.
const FIELD_ALIASES: Record<string, string[]> = {
  // Contact
  linkedin_url: ["person linkedin url", "linkedin url", "linkedin profile", "linkedin profile url", "linkedin link", "profile url"],
  instagram_url: ["instagram", "instagram url", "instagram handle", "instagram username", "instagram profile", "ig", "ig handle"],
  first_name: ["first name", "given name"],
  last_name: ["last name", "surname", "family name"],
  job_title: ["title", "job title", "position", "job role", "role", "designation", "current title"],
  seniority: ["seniority", "seniority level"],
  departments: ["department", "departments", "job function", "functional area"],

  // Email
  email: ["email", "email address", "work email", "business email", "primary email", "professional email", "work mail", "email id"],
  email_status: ["email status"],
  email_source: ["email source", "primary email source"],
  email_confidence: ["email confidence"],
  email_catchall_status: ["primary email catch-all status", "catch-all status", "email catch-all status"],
  email_last_verified: ["primary email last verified at", "email last verified at", "email last verified"],
  secondary_email: ["secondary email", "personal email", "alternate email", "alternative email", "email 2"],
  secondary_email_source: ["secondary email source"],
  tertiary_email: ["tertiary email", "email 3"],
  tertiary_email_source: ["tertiary email source"],
  email_sent: ["email sent"],
  email_open: ["email open", "email opened"],
  email_bounced: ["email bounced"],

  // Phone
  work_direct_phone: ["work direct phone", "direct phone", "phone", "phone number", "telephone", "work phone", "business phone", "direct dial"],
  mobile_phone: ["mobile phone", "mobile", "cell", "cell phone", "mobile number"],
  home_phone: ["home phone"],
  corporate_phone: ["corporate phone", "office phone", "main phone", "hq phone", "headquarters phone"],
  other_phone: ["other phone"],

  // Person location
  city: ["city"],
  state: ["state", "province"],
  country: ["country"],

  // Enrichment
  linkedin_bio: ["linkedin bio", "linkedin summary", "bio"],
  home_page_text: ["home page text", "website text", "home page copy", "home page content", "website content"],

  // Company
  company: ["company", "company name", "company name for emails", "organization", "organization name", "employer"],
  company_website: ["website", "company website", "website url", "company website url", "company domain", "domain", "homepage", "company url"],
  company_linkedin_url: ["company linkedin url", "company linkedin", "company linkedin profile"],
  company_address: ["company address"],
  company_city: ["company city"],
  company_state: ["company state"],
  company_country: ["company country"],
  company_phone: ["company phone", "company phone number"],
  employee_count: ["employees", "employee count", "number of employees", "headcount", "company size", "employee size"],
  industry: ["industry"],
  keywords: ["keywords"],
  technologies: ["technologies", "technology", "tech stack"],
  annual_revenue: ["annual revenue", "revenue"],
  total_funding: ["total funding"],
  latest_funding: ["latest funding"],
  latest_funding_amount: ["latest funding amount"],
  last_raised_at: ["last raised at"],
  subsidiary_of: ["subsidiary of"],
  retail_locations: ["number of retail locations", "retail locations"],

  // Social
  facebook_url: ["facebook url", "facebook"],
  twitter_url: ["twitter url", "twitter"],

  // CRM / tracking
  stage: ["stage"],
  lists: ["lists"],
  last_contacted: ["last contacted"],
  replied: ["replied"],
  demoed: ["demoed"],

  // External IDs
  apollo_contact_id: ["apollo contact id"],
  apollo_account_id: ["apollo account id"],
};

// rank = position in the field's list, so the canonical alias ("Company Name") outranks a looser one ("Organization").
const ALIAS_INDEX = new Map<string, { field: string; rank: number }>();
for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
  aliases.forEach((alias, rank) => {
    const key = compact(alias);
    if (!ALIAS_INDEX.has(key)) ALIAS_INDEX.set(key, { field, rank });
  });
}

interface TokenRule {
  field: string;
  // Every one of these words must appear in the header.
  all: string[];
  // None of these words may appear in the header.
  none?: string[];
}

const EMAIL_QUALIFIERS = [
  "domain", "status", "source", "confidence", "catchall", "verified", "verification", "last",
  "sent", "open", "opened", "bounce", "bounced", "secondary", "tertiary", "personal", "alternate",
  "alternative", "second", "third", "sender", "manager", "assistant", "count", "date", "valid",
  "validity", "score", "risk", "guess", "found", "2", "3",
];

const COMPANY_QUALIFIERS = [
  "linkedin", "website", "domain", "url", "phone", "address", "city", "state", "country", "size",
  "employee", "employees", "industry", "revenue", "funding", "technologies", "tech", "keywords",
  "zip", "postal", "street", "email", "id",
];

const WEBSITE_TEXT = ["text", "content", "copy", "body", "summary"];

// Used only when no exact alias matched. The most specific rule wins: the one with the most
// required words. On a tie, the rule listed first wins.
const TOKEN_RULES: TokenRule[] = [
  // Email
  { field: "email", all: ["email"], none: EMAIL_QUALIFIERS },
  { field: "email_status", all: ["email", "status"] },
  { field: "email_source", all: ["email", "source"] },
  { field: "email_confidence", all: ["email", "confidence"] },
  { field: "email_catchall_status", all: ["email", "catchall"] },
  { field: "email_last_verified", all: ["email", "verified"] },
  { field: "email_sent", all: ["email", "sent"] },
  { field: "email_open", all: ["email", "open"] },
  { field: "email_open", all: ["email", "opened"] },
  { field: "email_bounced", all: ["email", "bounced"] },
  { field: "email_bounced", all: ["email", "bounce"] },
  { field: "secondary_email", all: ["secondary", "email"] },
  { field: "secondary_email", all: ["second", "email"] },
  { field: "secondary_email", all: ["personal", "email"] },
  { field: "secondary_email", all: ["alternate", "email"] },
  { field: "secondary_email", all: ["alternative", "email"] },
  { field: "secondary_email", all: ["email", "2"] },
  { field: "secondary_email_source", all: ["secondary", "email", "source"] },
  { field: "secondary_email_source", all: ["personal", "email", "source"] },
  { field: "tertiary_email", all: ["tertiary", "email"] },
  { field: "tertiary_email", all: ["third", "email"] },
  { field: "tertiary_email", all: ["email", "3"] },
  { field: "tertiary_email_source", all: ["tertiary", "email", "source"] },
  { field: "tertiary_email_source", all: ["third", "email", "source"] },

  // Phone
  { field: "work_direct_phone", all: ["phone"] },
  { field: "work_direct_phone", all: ["telephone"] },
  { field: "work_direct_phone", all: ["direct", "phone"] },
  { field: "work_direct_phone", all: ["direct", "dial"] },
  { field: "work_direct_phone", all: ["work", "phone"] },
  { field: "work_direct_phone", all: ["business", "phone"] },
  { field: "mobile_phone", all: ["mobile"] },
  { field: "mobile_phone", all: ["cell"] },
  { field: "home_phone", all: ["home", "phone"] },
  { field: "corporate_phone", all: ["corporate", "phone"] },
  { field: "corporate_phone", all: ["office", "phone"] },
  { field: "corporate_phone", all: ["main", "phone"] },
  { field: "corporate_phone", all: ["hq", "phone"] },
  { field: "corporate_phone", all: ["headquarters", "phone"] },
  { field: "company_phone", all: ["company", "phone"] },
  { field: "company_phone", all: ["organization", "phone"] },
  { field: "other_phone", all: ["other", "phone"] },

  // Names
  { field: "first_name", all: ["first", "name"] },
  { field: "first_name", all: ["given", "name"] },
  { field: "last_name", all: ["last", "name"] },
  { field: "last_name", all: ["surname"] },
  { field: "last_name", all: ["family", "name"] },

  // Job
  { field: "job_title", all: ["title"], none: ["company", "organization", "page"] },
  { field: "job_title", all: ["job", "title"] },
  { field: "job_title", all: ["job", "role"] },
  { field: "job_title", all: ["position"] },
  { field: "job_title", all: ["role"] },
  { field: "job_title", all: ["designation"] },
  { field: "seniority", all: ["seniority"] },
  { field: "departments", all: ["department"] },
  { field: "departments", all: ["job", "function"] },
  { field: "departments", all: ["functional", "area"] },
  { field: "departments", all: ["function"] },

  // Person location
  { field: "city", all: ["city"], none: ["company", "organization"] },
  { field: "state", all: ["state"], none: ["company", "organization"] },
  { field: "country", all: ["country"], none: ["company", "organization"] },

  // Company location
  { field: "company_city", all: ["company", "city"] },
  { field: "company_city", all: ["organization", "city"] },
  { field: "company_state", all: ["company", "state"] },
  { field: "company_state", all: ["organization", "state"] },
  { field: "company_country", all: ["company", "country"] },
  { field: "company_country", all: ["organization", "country"] },
  { field: "company_address", all: ["company", "address"] },
  { field: "company_address", all: ["organization", "address"] },

  // Company identity
  { field: "company", all: ["company"], none: COMPANY_QUALIFIERS },
  { field: "company", all: ["organization"], none: COMPANY_QUALIFIERS },
  { field: "company", all: ["employer"] },
  { field: "company_linkedin_url", all: ["company", "linkedin"] },
  { field: "company_linkedin_url", all: ["organization", "linkedin"] },
  { field: "company_website", all: ["website"], none: WEBSITE_TEXT },
  { field: "company_website", all: ["homepage"], none: WEBSITE_TEXT },
  { field: "company_website", all: ["domain"], none: ["email", "mail", "sender"] },
  { field: "company_website", all: ["company", "url"] },
  { field: "company_website", all: ["company", "site"] },
  { field: "employee_count", all: ["employee"], none: ["email", "id", "name", "title", "linkedin", "url", "phone", "mail", "status"] },
  { field: "employee_count", all: ["headcount"] },
  { field: "employee_count", all: ["head", "count"] },
  { field: "employee_count", all: ["company", "size"] },
  { field: "employee_count", all: ["number", "employees"] },
  { field: "industry", all: ["industry"] },
  { field: "keywords", all: ["keyword"] },
  { field: "technologies", all: ["technology"] },
  { field: "technologies", all: ["tech", "stack"] },
  { field: "annual_revenue", all: ["revenue"] },
  { field: "total_funding", all: ["total", "funding"] },
  { field: "latest_funding_amount", all: ["latest", "funding", "amount"] },
  { field: "latest_funding_amount", all: ["last", "funding", "amount"] },
  { field: "latest_funding", all: ["latest", "funding"] },
  { field: "latest_funding", all: ["last", "funding"] },
  { field: "last_raised_at", all: ["last", "raised"] },
  { field: "subsidiary_of", all: ["subsidiary"] },
  { field: "retail_locations", all: ["retail", "locations"] },

  // Text / enrichment
  { field: "linkedin_url", all: ["linkedin"], none: ["company", "organization", "bio", "summary", "about", "headline", "followers", "connections", "industry", "size", "employees"] },
  { field: "linkedin_bio", all: ["linkedin", "bio"] },
  { field: "linkedin_bio", all: ["linkedin", "summary"] },
  { field: "linkedin_bio", all: ["linkedin", "about"] },
  { field: "home_page_text", all: ["homepage", "text"] },
  { field: "home_page_text", all: ["homepage", "content"] },
  { field: "home_page_text", all: ["website", "text"] },
  { field: "home_page_text", all: ["website", "content"] },
  { field: "home_page_text", all: ["site", "text"] },
  { field: "home_page_text", all: ["website", "copy"] },

  // Social
  { field: "facebook_url", all: ["facebook"] },
  { field: "twitter_url", all: ["twitter"] },
  { field: "instagram_url", all: ["instagram"] },

  // CRM / tracking
  { field: "last_contacted", all: ["last", "contacted"] },
  { field: "stage", all: ["stage"] },
  { field: "lists", all: ["lists"] },
  { field: "replied", all: ["replied"] },
  { field: "demoed", all: ["demoed"] },
];

// A rule word matches a header word if they are equal or the header word is its plural.
const hasWord = (words: string[], word: string) => words.some((w) => w === word || w === `${word}s`);

function matchTokenRule(words: string[]): { field: string; size: number } | null {
  let best: { field: string; size: number } | null = null;
  for (const rule of TOKEN_RULES) {
    if (!rule.all.every((word) => hasWord(words, word))) continue;
    if (rule.none?.some((word) => hasWord(words, word))) continue;
    if (!best || rule.all.length > best.size) {
      best = { field: rule.field, size: rule.all.length };
    }
  }
  return best;
}

interface Candidate {
  index: number;
  field: string;
  exact: boolean;
  // exact: negated alias rank (higher = more canonical); token: number of rule words (higher = more specific)
  strength: number;
}

// Maps every header to a target field, or "skip" when nothing matches.
// Greedy: the strongest candidates claim their field first, and a field goes to one column only.
export function buildAutoFieldMappings(headers: string[]): AutoFieldMapping[] {
  const candidates: Candidate[] = [];
  headers.forEach((header, index) => {
    const alias = ALIAS_INDEX.get(compact(header));
    if (alias) {
      candidates.push({ index, field: alias.field, exact: true, strength: -alias.rank });
      return;
    }
    const rule = matchTokenRule(tokenize(header));
    if (rule) {
      candidates.push({ index, field: rule.field, exact: false, strength: rule.size });
    }
  });

  candidates.sort(
    (a, b) =>
      Number(b.exact) - Number(a.exact) ||
      b.strength - a.strength ||
      a.index - b.index
  );

  const assigned = new Map<number, string>();
  const taken = new Set<string>();
  for (const candidate of candidates) {
    if (assigned.has(candidate.index) || taken.has(candidate.field)) continue;
    assigned.set(candidate.index, candidate.field);
    taken.add(candidate.field);
  }

  return headers.map((csvColumn, index) => ({
    csvColumn,
    targetField: assigned.get(index) ?? "skip",
  }));
}
