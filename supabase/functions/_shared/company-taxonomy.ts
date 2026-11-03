/**
 * Closed taxonomy for company classification.
 *
 * This list is the whole answer to "will a cheap model be consistent?".
 * Free-form classification is not reproducible — two plumbers come back as
 * "Plumbing" and "Plumbing Services" and neither matches your ICP rule. Forcing
 * the model to pick from a fixed enum makes consistency structural rather than
 * something you hope for, and lets a small cheap model do the job as well as a
 * large one.
 *
 * Appending is safe. RENAMING OR REMOVING A SLUG IS NOT — cached rows in
 * crm_companies carry these values, and ICP rules match on them. Add, never
 * rewrite.
 */

export const COMPANY_CATEGORIES = [
  // trades / home & commercial services
  'hvac',
  'plumbing',
  'electrical',
  'roofing',
  'landscaping',
  'cleaning_facilities',
  'pest_control',
  'general_contractor',
  'home_services_other',
  // physical operations
  'manufacturing',
  'logistics_transport',
  'wholesale_distribution',
  'construction_civil',
  'automotive',
  'agriculture',
  'energy_utilities',
  // consumer
  'restaurant_food',
  'retail_store',
  'ecommerce_dtc',
  'hospitality_travel',
  'fitness_wellness',
  'salon_spa',
  // professional
  'marketing_agency',
  'consulting',
  'accounting_tax',
  'legal',
  'staffing_recruiting',
  'insurance',
  'financial_services',
  'real_estate',
  'property_management',
  // technical
  'saas_software',
  'it_services_msp',
  'engineering_services',
  'telecom_isp',
  // institutional
  'healthcare_provider',
  'dental',
  'veterinary',
  'education',
  'nonprofit',
  'government',
  // fallbacks — deliberately distinct
  'other',       // a real business, but outside the list
  'unclear',     // the page did not say enough to decide
] as const;

export type CompanyCategory = typeof COMPANY_CATEGORIES[number];

/** Categories that mean "we learned nothing" — never treat these as a match. */
export const NON_ANSWERS: ReadonlySet<string> = new Set(['other', 'unclear']);

export interface ClassificationInput {
  domain: string;
  company_name?: string | null;
  title?: string | null;
  description?: string | null;
  h1?: string | null;
}

export interface Classification {
  domain: string;
  category: CompanyCategory | string;
  confidence: 'high' | 'medium' | 'low';
  /** Free-text location if the page states one — usually more reliable than the pool's state column. */
  location?: string | null;
  /** Short justification, kept for spot-checking drift. */
  evidence?: string | null;
}

/**
 * The model sees only what a metadata fetch returns. Kept deliberately short:
 * the whole economic argument is a few hundred tokens per company, so the
 * prompt must not dwarf the payload.
 */
export function buildPrompt(items: ClassificationInput[]): string {
  // Only what the company PUBLISHES about itself. Neither the domain string
  // nor the company name is shown to the model — both are names, and names are
  // not evidence of activity. Given a name, the model reasons from vocabulary
  // ("Gardner Resources" → staffing, "Home Technologies often HVAC") and
  // returns a coin flip wearing a category. Measured on the 1-10 employee band:
  // 37.5% of all output was name-inference of that kind. If the page cannot be
  // read, the honest answer is `unclear`.
  const lines = items.map((it, i) =>
    `${i + 1}.` +
    (it.title ? ` title=${it.title}` : '') +
    (it.description ? ` | desc=${it.description}` : '') +
    (it.h1 ? ` | h1=${it.h1}` : '')
  ).join('\n');

  return `Classify each business into EXACTLY ONE category from this list. Use the exact slug.

CATEGORIES:
${COMPANY_CATEGORIES.join(', ')}

RULES:
- Pick the company's PRIMARY line of business, not a service they mention in passing.
- Judge ONLY what this text says the company does. Do not infer from a company
  name, a brand, or a word like "Solutions", "Resources" or "Technologies".
- Classify what the company DOES, not the industry it serves. "X Roofing Supply"
  is wholesale_distribution, "Delta Dental" (an insurer) is insurance, a firm
  that manufactures roofing material is manufacturing.
- "other" = a real business that fits none of the categories.
- "unclear" = the text does not say what the business does. Prefer it over a
  guess: an honest gap is usable, a confident wrong category is not.
- Never invent a category outside the list.
- confidence: high = the text states it plainly; medium = strongly implied; low = a guess.
- location: only if the text names a city/state/country. Otherwise null.
- evidence: at most 8 words quoted or paraphrased from the input.

BUSINESSES:
${lines}

Return ONLY a JSON array, one object per business, in the same order:
[{"n":1,"category":"<slug>","confidence":"high|medium|low","location":"<or null>","evidence":"<short>"}]`;
}

/** Parse the model's reply, dropping anything that isn't a known slug. */
export function parseResponse(
  raw: string,
  items: ClassificationInput[],
): Classification[] {
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('model returned no JSON array');

  const parsed = JSON.parse(match[0]) as Array<Record<string, unknown>>;
  const valid = new Set<string>(COMPANY_CATEGORIES);
  const out: Classification[] = [];

  for (const row of parsed) {
    const n = Number(row.n);
    const item = items[n - 1];
    if (!item) continue;
    const category = String(row.category ?? '').trim().toLowerCase();
    out.push({
      domain: item.domain,
      // An out-of-enum answer is a failure to classify, not a new category.
      category: valid.has(category) ? category : 'unclear',
      confidence: (['high', 'medium', 'low'].includes(String(row.confidence))
        ? String(row.confidence)
        : 'low') as Classification['confidence'],
      location: row.location ? String(row.location).slice(0, 120) : null,
      evidence: row.evidence ? String(row.evidence).slice(0, 160) : null,
    });
  }
  return out;
}
