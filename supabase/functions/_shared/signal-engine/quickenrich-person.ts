import { isPlausibleHumanName } from "../list-building/name-validator.ts";

export interface QuickenrichSignalEmployee {
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  name?: string | null;
  title?: string | null;
  employee_linkedin?: string | null;
  linkedin_url?: string | null;
  email?: string | null;
  email_verification_date?: string | null;
  email_domain?: string | null;
  company_url?: string | null;
  employee_count?: string | number | null;
  revenue?: string | null;
  industry?: string | null;
  country_code?: string | null;
  region_code?: string | null;
  city?: string | null;
  has_email?: boolean | null;
}

export type SignalBuyerPersona =
  | "executive"
  | "sales_revenue"
  | "marketing_growth";

export interface SignalPersonCandidate {
  first_name: string;
  last_name: string;
  full_name: string;
  title: string;
  linkedin_url: string;
  outreach_persona: SignalBuyerPersona;
  seniority_rank: number;
}

export interface NormalizedSignalPerson {
  full_name: string;
  title: string;
  linkedin_url: string;
  email: string;
  email_status: "verified" | "provider_found";
  outreach_persona: SignalBuyerPersona;
  seniority_rank: number;
}

function letters(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(
    /[^a-z]/g,
    "",
  );
}

function nameMatchesValue(first: string, last: string, value: string): boolean {
  const normalized = letters(value);
  const firstToken = letters(first);
  const lastToken = letters(last);
  return (firstToken.length >= 3 && normalized.includes(firstToken)) ||
    (lastToken.length >= 3 && !["null", "none"].includes(lastToken) &&
      normalized.includes(lastToken));
}

function canonicalLinkedin(value: string): string | null {
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    if (!/(^|\.)linkedin\.com$/i.test(url.hostname)) return null;
    const match = /^\/in\/([^/]+)\/?$/i.exec(url.pathname);
    if (!match) return null;
    return `https://www.linkedin.com/in/${match[1]}`;
  } catch {
    return null;
  }
}

const LEADERSHIP =
  /\b(chief|vp|svp|evp|vice president|head(?:\s+of)?|director(?:\s+of)?)\b/i;
const SALES_REVENUE =
  /\b(sales|revenue|commercial|business development|partnerships?|alliances?|channel)\b/i;
const MARKETING_GROWTH =
  /\b(marketing|growth|demand generation|demand gen|go[ -]to[ -]market|gtm|brand)\b/i;
const NON_BUYER =
  /\b(assistant|associate|advisor|consultant|coordinator|intern|student|account manager|partner manager|partner advisor|people partner|human resources partner|hr partner|product owner|process owner|office of (?:the )?ceo)\b/i;

export function classifySignalBuyerPersona(
  titleValue: string | null | undefined,
): {
  persona: SignalBuyerPersona;
  priority: number;
} | null {
  const title = String(titleValue ?? "").trim();
  if (!title || NON_BUYER.test(title)) return null;

  const executive =
    /\b(co[ -]?founder|founder|ceo|chief executive(?: officer)?|managing director|managing partner|general partner|founding partner)\b/i
      .test(title) ||
    (/\b(owner|president)\b/i.test(title) &&
      !/\b(vice president|product owner|process owner)\b/i.test(title));
  if (executive) {
    const priority =
      /\b(co[ -]?founder|founder|ceo|chief executive)\b/i.test(title)
        ? 100
        : 95;
    return { persona: "executive", priority };
  }

  const salesChief =
    /\b(chief revenue officer|chief sales officer|chief commercial officer|cro)\b/i
      .test(title);
  if (salesChief || (LEADERSHIP.test(title) && SALES_REVENUE.test(title))) {
    return {
      persona: "sales_revenue",
      priority: salesChief
        ? 90
        : /\b(vp|svp|evp|vice president)\b/i.test(title)
        ? 85
        : /\bhead\b/i.test(title)
        ? 80
        : 70,
    };
  }

  const marketingChief =
    /\b(chief marketing officer|chief growth officer|cmo)\b/i.test(title);
  if (
    marketingChief || (LEADERSHIP.test(title) && MARKETING_GROWTH.test(title))
  ) {
    return {
      persona: "marketing_growth",
      priority: marketingChief
        ? 90
        : /\b(vp|svp|evp|vice president)\b/i.test(title)
        ? 85
        : /\bhead\b/i.test(title)
        ? 80
        : 70,
    };
  }
  return null;
}

function personName(
  row: QuickenrichSignalEmployee,
): { first: string; last: string; fullName: string } | null {
  const explicitFirst = String(row.first_name ?? "").trim();
  const explicitLast = String(row.last_name ?? "").trim();
  const fallbackName = String(row.full_name ?? row.name ?? "").trim();
  const fallbackParts = fallbackName.split(/\s+/).filter(Boolean);
  const first = explicitFirst || fallbackParts[0] || "";
  const last = explicitLast || fallbackParts.slice(1).join(" ");
  if (!isPlausibleHumanName(first, last || null)) return null;
  return { first, last, fullName: `${first} ${last}`.trim() };
}

export function normalizeQuickenrichSignalCandidate(
  row: QuickenrichSignalEmployee,
  requestedDomain: string,
  normalizeDomain: (value: unknown) => string | null,
): SignalPersonCandidate | null {
  const returnedDomain = normalizeDomain(row.email_domain ?? row.company_url);
  if (returnedDomain && returnedDomain !== requestedDomain) return null;
  const name = personName(row);
  const title = String(row.title ?? "").trim();
  const classification = classifySignalBuyerPersona(title);
  const linkedin = canonicalLinkedin(
    String(row.employee_linkedin ?? row.linkedin_url ?? "").trim(),
  );
  if (!name || !classification || !linkedin) return null;
  const linkedinSlug = linkedin.split("/in/")[1] ?? "";
  if (!nameMatchesValue(name.first, name.last, linkedinSlug)) return null;
  return {
    first_name: name.first,
    last_name: name.last,
    full_name: name.fullName,
    title,
    linkedin_url: linkedin,
    outreach_persona: classification.persona,
    seniority_rank: classification.priority,
  };
}

export function prioritizeSignalCandidates(
  candidates: SignalPersonCandidate[],
  existingPersonas: Iterable<SignalBuyerPersona> = [],
): SignalPersonCandidate[] {
  const covered = new Set(existingPersonas);
  const unique = candidates
    .filter((candidate, index, all) =>
      all.findIndex((other) =>
        other.linkedin_url === candidate.linkedin_url
      ) === index
    )
    .sort((a, b) =>
      b.seniority_rank - a.seniority_rank ||
      a.full_name.localeCompare(b.full_name)
    );
  const ordered: SignalPersonCandidate[] = [];
  for (
    const persona of ["executive", "sales_revenue", "marketing_growth"] as const
  ) {
    if (covered.has(persona)) continue;
    ordered.push(
      ...unique.filter((candidate) => candidate.outreach_persona === persona),
    );
  }
  return ordered;
}

export function normalizeQuickenrichSignalPerson(
  row: QuickenrichSignalEmployee,
  requestedDomain: string,
  normalizeDomain: (value: unknown) => string | null,
  seniorityRank: (title: string | null) => number,
): NormalizedSignalPerson | null {
  const returnedDomain = normalizeDomain(row.email_domain ?? row.company_url);
  if (returnedDomain && returnedDomain !== requestedDomain) return null;

  const name = personName(row);
  if (!name) return null;

  // Provider records occasionally disagree internally. The structured name is
  // tied to the email lookup and therefore wins over a stale display_name.
  const linkedin = canonicalLinkedin(
    String(row.employee_linkedin ?? row.linkedin_url ?? "").trim(),
  );
  const email = String(row.email ?? "").trim().toLowerCase();
  const title = String(row.title ?? "").trim() || null;
  const rank = seniorityRank(title);
  if (
    !linkedin || !title || rank === 0 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) return null;

  const linkedinSlug = linkedin.split("/in/")[1] ?? "";
  const emailLocal = email.split("@")[0] ?? "";
  if (
    !nameMatchesValue(name.first, name.last, linkedinSlug) ||
    !nameMatchesValue(name.first, name.last, emailLocal)
  ) return null;

  const classification = classifySignalBuyerPersona(title);
  if (!classification) return null;

  return {
    full_name: name.fullName,
    title,
    linkedin_url: linkedin,
    email,
    email_status: row.email_verification_date ? "verified" : "provider_found",
    outreach_persona: classification.persona,
    seniority_rank: classification.priority,
  };
}
