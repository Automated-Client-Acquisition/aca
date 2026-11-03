export type MoltsetsPoolWriteback = {
  person: Record<string, unknown>;
  sourceCompany: Record<string, unknown>;
  currentDomain: string | null;
  movedEmployer: boolean;
};

export function normalizeMoltsetsDomain(value: unknown): string | null {
  const normalized = String(value ?? '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .split('/')[0]
    .toLowerCase();
  return normalized || null;
}

function positiveEmployeeCount(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

/**
 * Project every known MoltSets field into typed ACA columns while retaining the
 * complete response in JSONB. Top-level location belongs to the person. Company
 * location is only accepted from the nested company object.
 */
export function buildMoltsetsPoolWriteback(
  data: Record<string, unknown>,
  inputLinkedInUrl: string,
  sourceDomain: string,
  checkedAt: string,
): MoltsetsPoolWriteback {
  const company = data.company && typeof data.company === 'object' && !Array.isArray(data.company)
    ? data.company as Record<string, unknown>
    : {};
  const normalizedSource = normalizeMoltsetsDomain(sourceDomain) ?? sourceDomain.toLowerCase();
  const currentDomain = normalizeMoltsetsDomain(company.website_url ?? company.domain);
  const movedEmployer = Boolean(currentDomain && currentDomain !== normalizedSource);
  const employeeCount = positiveEmployeeCount(
    company.employee_count ?? company.employees ?? company.size,
  );
  const linkedinUrl = data.linkedin_url ?? inputLinkedInUrl;

  const person: Record<string, unknown> = {
    linkedin_url: linkedinUrl,
    first_name: data.first_name ?? null,
    last_name: data.last_name ?? null,
    full_name: data.full_name ?? null,
    title: data.title ?? null,
    headline: data.headline ?? null,
    seniority: data.seniority ?? null,
    city: data.city ?? null,
    state: data.state ?? null,
    country: data.country ?? null,
    company_domain: currentDomain,
    company_name: company.name ?? null,
    company_linkedin_url: company.linkedin_url ?? null,
    company_country: company.country ?? null,
    company_state: company.state ?? null,
    company_city: company.city ?? null,
    employee_count: employeeCount === null ? null : String(employeeCount),
    employee_range: company.employee_range ?? company.employee_range_label ?? null,
    revenue_range: company.revenue_range ?? null,
    linkedin_industry: company.industry ?? null,
    business_email: data.business_email ?? null,
    business_email_validated_at: data.business_email_validated_at ?? null,
    business_email_risk: data.business_email_risk_score ?? null,
    personal_email: data.personal_email ?? null,
    personal_email_validated_at: data.personal_email_validated_at ?? null,
    personal_email_risk: data.personal_email_risk_score ?? null,
    source_updated_at: data.last_updated_at ?? null,
    moltsets_payload: data,
    moltsets_company_payload: company,
    status: 'found',
  };

  const companyMatchesSource = currentDomain === normalizedSource;
  const sourceCompany: Record<string, unknown> = {
    domain: normalizedSource,
    linkedin_url: linkedinUrl,
    moltsets_status: 'found',
    moltsets_checked_at: checkedAt,
    ...(companyMatchesSource
      ? {
          company_name: company.name ?? null,
          employee_count: employeeCount,
          employee_range: company.employee_range ?? company.employee_range_label ?? null,
          revenue_range: company.revenue_range ?? null,
          linkedin_industry: company.industry ?? null,
          company_linkedin_url: company.linkedin_url ?? null,
          company_country: company.country ?? null,
          company_state: company.state ?? null,
          company_city: company.city ?? null,
          moltsets_company_payload: company,
          source_updated_at: data.last_updated_at ?? null,
          business_email: data.business_email ?? null,
          business_email_validated_at: data.business_email_validated_at ?? null,
          business_email_risk: data.business_email_risk_score ?? null,
          moltsets_location: [data.city, data.state, data.country].filter(Boolean).join(', ') || null,
        }
      : {}),
  };

  return { person, sourceCompany, currentDomain, movedEmployer };
}
