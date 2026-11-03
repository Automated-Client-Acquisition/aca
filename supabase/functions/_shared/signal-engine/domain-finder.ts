/**
 * Rung 3.5 — bulk company-name → domain via the Apify actor
 * `haketa/bulk-company-domain`, behind a hard verification gate.
 *
 * WHY A GATE, NOT A DIRECT PIPE
 * ---------------------------------------------------------------------------
 * The actor is cheap ($0.0008/result), fast (42 names in 7s) and runs before
 * the MoltSets search quota, which locks for days once spent. All good. But it
 * returns two very different kinds of answer under one schema, and only one of
 * them is evidence:
 *
 *   source: 'directory'  a real match, with `resolvedName` to check against
 *   source: 'dns-guess'  a domain CONSTRUCTED from the company name that
 *                        happens to resolve in DNS, with resolvedName EMPTY
 *
 * Measured on 42 unresolved SEC filers (2026-08-17): 22 got a domain, 21 of
 * them dns-guess. Spot-checking 8 of those guesses against their live
 * homepages, only 2 were the right company:
 *
 *   cubytechnologies.com  "Cuby Technologies, Inc."           correct
 *   shiftcapital.com      "Shift Capital"                     correct
 *   siox.com              "Fire Damper Control Systems…"      DIFFERENT COMPANY
 *   twinprimeai.com       "TwinPrimeAi.com for sale | …"      PARKED DOMAIN
 *   alphaexploration.com, onenav.com, datag.com, harton.com   dead
 *
 * A domain resolving in DNS only proves somebody owns it. Accepting that blind
 * would put parked domains and unrelated businesses into lead lists and email
 * them about funding rounds they did not raise.
 *
 * THE TWO CHECKS THAT MATTER
 * ---------------------------------------------------------------------------
 * 1. Name must appear in <title>, <h1> or meta description — NOT just anywhere
 *    in the body. siox.com mentions "SIOX" in its body (it is their brand) but
 *    not in the title, so a body-wide search accepts it and a title check
 *    rejects it. That single distinction is the difference between the two
 *    outcomes above.
 * 2. Explicit parking detection, because a parked page cheerfully echoes the
 *    company name back at you — twinprimeai.com's title literally contains
 *    "TwinPrimeAi", so the name check alone passes it.
 */

import { namesMatch, normalizeCompanyName, normalizeDomain } from './normalize.ts';

const ACTOR_ID = 'tMPUyIxvSchXghUFC'; // haketa/bulk-company-domain
const ACTOR_SYNC_URL = `https://api.apify.com/v2/acts/${ACTOR_ID}/run-sync-get-dataset-items`;

export interface DomainCandidate {
  companyName: string;
  domain: string | null;
  resolvedName: string | null;
  source: string | null;   // 'directory' | 'dns-guess' | 'none'
  dnsResolves: boolean;
}

export interface VerifiedDomain {
  companyName: string;
  domain: string;
  via: 'apify_directory' | 'apify_verified_guess';
  evidence: string;
}

/** Registrar / parking markers. A parked page echoes the name back at you. */
const PARKING_MARKERS = [
  'for sale', 'buy this domain', 'domain is for sale', 'domain parking',
  'parked domain', 'sedo.com', 'afternic', 'dan.com', 'spaceship.com',
  'hugedomains', 'godaddy.com/domainsearch', 'namecheap.com/domains/registration',
  'this domain may be for sale', 'inquire about this domain', 'undeveloped',
];

const PLACEHOLDER_TITLES = [
  'index of /', 'welcome to nginx', 'apache2 ubuntu default page',
  'it works!', 'default web site page', 'coming soon', 'under construction',
  'account suspended', 'website disabled',
];

/**
 * Anti-bot interstitials. These are not evidence in either direction — the real
 * page is behind them — so they must not be read as confirmation. Dangerous
 * because a challenge page can echo the requested hostname back, which would
 * otherwise satisfy the name check on no evidence at all.
 */
const INTERSTITIAL_MARKERS = [
  'checking your browser', 'just a moment', 'attention required',
  'enable javascript and cookies', 'ddos protection', 'verifying you are human',
  'please wait while we verify', 'security check',
];

export async function findDomainsBulk(
  apifyToken: string,
  names: string[],
  signal?: AbortSignal,
): Promise<DomainCandidate[]> {
  if (names.length === 0) return [];

  const resp = await fetch(`${ACTOR_SYNC_URL}?token=${apifyToken}&format=json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      companyNames: names,
      verifyDns: true,
      // Guesses are kept because the gate below is what makes them safe. With
      // the gate they add coverage; without it they would be a liability.
      dnsGuessFallback: true,
      maxConcurrency: 10,
      maxItems: 0,
    }),
    signal,
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`bulk-company-domain actor ${resp.status}: ${body.slice(0, 200)}`);
  }

  const json = await resp.json().catch(() => null);
  const rows: Array<Record<string, unknown>> = Array.isArray(json) ? json : [];
  return rows.map((r) => ({
    companyName: String(r.companyName ?? ''),
    domain: normalizeDomain(String(r.domain ?? '')) ,
    resolvedName: r.resolvedName ? String(r.resolvedName) : null,
    source: r.source ? String(r.source) : null,
    dnsResolves: String(r.dnsResolves ?? '') === 'true',
  }));
}

interface PageFacts {
  title: string;
  h1: string;
  description: string;
  ok: boolean;
}

async function fetchPageFacts(domain: string, signal?: AbortSignal): Promise<PageFacts | null> {
  for (const url of [`https://${domain}`, `http://${domain}`]) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12_000);
      signal?.addEventListener('abort', () => ctrl.abort(), { once: true });
      const resp = await fetch(url, {
        redirect: 'follow',
        signal: ctrl.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; ACA-SignalEngine/1.0)',
          Accept: 'text/html,application/xhtml+xml',
        },
      });
      clearTimeout(timer);
      if (!resp.ok) continue;
      const html = (await resp.text()).slice(0, 60_000);
      const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '';
      const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ?? '';
      const description =
        /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)/i.exec(html)?.[1] ?? '';
      return {
        title: stripTags(title),
        h1: stripTags(h1),
        description: stripTags(description),
        ok: true,
      };
    } catch {
      // try next scheme
    }
  }
  return null;
}

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Does this page belong to this company?
 *
 * Only the identity-bearing parts of the page count. A body-wide search accepts
 * siox.com for "SIOX, LLC" because SIOX is the page owner's own brand — a
 * different company that happens to share a short name.
 */
export function verifyPageBelongsTo(
  companyName: string,
  facts: PageFacts,
  domain?: string,
): { ok: boolean; reason: string } {
  const haystack = `${facts.title} ${facts.h1} ${facts.description}`.toLowerCase();

  if (!haystack.trim()) return { ok: false, reason: 'no title/h1/meta' };

  for (const marker of PARKING_MARKERS) {
    if (haystack.includes(marker)) return { ok: false, reason: `parked/for-sale (${marker})` };
  }
  for (const placeholder of PLACEHOLDER_TITLES) {
    if (facts.title.toLowerCase().includes(placeholder)) {
      return { ok: false, reason: `placeholder page (${placeholder})` };
    }
  }
  for (const marker of INTERSTITIAL_MARKERS) {
    if (haystack.includes(marker)) {
      return { ok: false, reason: `anti-bot interstitial (${marker}) — inconclusive, retry later` };
    }
  }

  // A title that is the bare domain INCLUDING the TLD ("primalfootprint.com")
  // is a holding-page smell. Note the contrast with a title that is the name
  // WITHOUT the TLD ("Civarro" for civarro.com) — that is a real site branding
  // itself, and must still pass.
  if (domain) {
    const squashT = facts.title.toLowerCase().replace(/[^a-z0-9.]/g, '');
    if (squashT === domain.toLowerCase()) {
      return { ok: false, reason: `title is the bare domain ("${facts.title}") — likely holding page` };
    }
  }

  const norm = normalizeCompanyName(companyName);
  if (!norm) return { ok: false, reason: 'unusable company name' };

  // Compare on letters only, so "Cuby Technologies, Inc." matches a title
  // rendered as "Cuby Technologies Inc" or "CubyTechnologies".
  const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const needle = squash(norm);
  const hay = squash(haystack);

  if (needle.length >= 5 && hay.includes(needle)) {
    return { ok: true, reason: `name in title/h1/meta: "${facts.title.slice(0, 60)}"` };
  }

  // Short names ("SIOX", "DATAG") collide constantly, so they must match the
  // title as a whole word rather than as a substring of something else.
  if (needle.length < 5) {
    const words = haystack.split(/[^a-z0-9]+/);
    if (words.includes(norm.toLowerCase())) {
      return { ok: true, reason: `short name matched as whole word in title` };
    }
    return { ok: false, reason: `short name "${norm}" not a whole-word title match` };
  }

  return { ok: false, reason: `name not in title/h1/meta ("${facts.title.slice(0, 60)}")` };
}

/**
 * Turn raw actor output into domains we are willing to act on.
 *
 * Directory hits are trusted after a name check. Guesses must additionally
 * survive a live homepage inspection. Anything else is dropped — an unresolved
 * company costs one lead, a wrong one costs the credibility of the send.
 */
export async function verifyCandidates(
  candidates: DomainCandidate[],
  signal?: AbortSignal,
): Promise<{ verified: VerifiedDomain[]; rejected: Array<{ name: string; domain: string; reason: string }> }> {
  const verified: VerifiedDomain[] = [];
  const rejected: Array<{ name: string; domain: string; reason: string }> = [];

  for (const c of candidates) {
    if (signal?.aborted) break;
    if (!c.domain) continue;

    const isDirectory = c.source === 'directory' && !!c.resolvedName;

    // A directory hit must still pass the NAME check — the label it returns is
    // what we are matching against.
    if (isDirectory && !namesMatch(c.companyName, c.resolvedName!)) {
      rejected.push({
        name: c.companyName,
        domain: c.domain,
        reason: `directory name mismatch ("${c.resolvedName}")`,
      });
      continue;
    }

    // EVERY candidate — directory included — must also prove out on the page.
    //
    // Directory hits were briefly exempt from this, on the reasoning that a
    // matching label was evidence enough. It is not: the directory returned
    // "Universal Health Services, Inc." (a perfect name match) attached to
    // uhsinc.co, which is dead. The real company is uhs.com. A name match tells
    // us the LABEL is right; only the page tells us the DOMAIN is.
    const facts = await fetchPageFacts(c.domain, signal);
    if (!facts) {
      rejected.push({
        name: c.companyName,
        domain: c.domain,
        reason: isDirectory ? 'directory domain unreachable' : 'homepage unreachable',
      });
      continue;
    }
    const check = verifyPageBelongsTo(c.companyName, facts, c.domain);
    if (check.ok) {
      verified.push({
        companyName: c.companyName,
        domain: c.domain,
        via: isDirectory ? 'apify_directory' : 'apify_verified_guess',
        evidence: isDirectory
          ? `directory "${c.resolvedName}" + page: ${check.reason}`
          : check.reason,
      });
    } else {
      rejected.push({ name: c.companyName, domain: c.domain, reason: check.reason });
    }
  }

  return { verified, rejected };
}
