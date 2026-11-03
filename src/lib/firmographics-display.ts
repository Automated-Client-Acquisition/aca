type UnknownRecord = Record<string, unknown> | null | undefined;

export interface FirmographicsSummary {
  employees?: string;
  industry?: string;
  revenue?: string;
  seniority?: string;
  source?: string;
}

const scalar = (...values: unknown[]): string | undefined => {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== '' && typeof value !== 'object') {
      return String(value);
    }
  }
  return undefined;
};

const sourceLabel = (value?: string): string | undefined => {
  if (!value) return undefined;
  return value.toLowerCase() === 'moltsets' ? 'MoltSets' : value;
};

export function getFirmographicsSummary(
  enrichmentData: UnknownRecord,
  customFields: UnknownRecord = null,
): FirmographicsSummary {
  const enrichment = enrichmentData || {};
  const custom = customFields || {};
  const company =
    enrichment.company && typeof enrichment.company === 'object'
      ? (enrichment.company as Record<string, unknown>)
      : {};

  return {
    employees: scalar(
      enrichment.employees_range,
      enrichment.employee_range,
      enrichment.employee_count,
      enrichment.employees,
      company.size,
      custom.employee_range,
      custom.employee_count,
    ),
    industry: scalar(enrichment.industry, company.industry, custom.industry),
    revenue: scalar(
      enrichment.revenue_range,
      enrichment.annual_revenue,
      enrichment.company_annual_revenue,
      company.revenue,
      custom.revenue_range,
    ),
    seniority: scalar(enrichment.seniority, enrichment.seniority_level, custom.seniority),
    source: sourceLabel(
      scalar(enrichment.enrichment_source, custom.firmographics_source),
    ),
  };
}
