// Single source of truth for the fixed-vocabulary chip options used by ICP
// targeting (AddICPDialog, ICPDetailsDialog, via IcpTargetingFields). Previously
// SENIORITY_OPTIONS/DEPARTMENT_OPTIONS were hardcoded independently in both
// dialogs, and EMPLOYEE_BAND_OPTIONS/REVENUE_BAND_OPTIONS were borrowed from
// usePublicSignalAutoEnroll.ts, an unrelated Autopilot hook.

export const SENIORITY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'owner', label: 'Owner' },
  { value: 'founder', label: 'Founder' },
  { value: 'c_suite', label: 'C-Suite' },
  { value: 'partner', label: 'Partner' },
  { value: 'vp', label: 'VP' },
  { value: 'head', label: 'Head' },
  { value: 'director', label: 'Director' },
  { value: 'manager', label: 'Manager' },
  { value: 'senior', label: 'Senior' },
  { value: 'entry', label: 'Entry' },
];

export const DEPARTMENT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'sales', label: 'Sales' },
  { value: 'marketing', label: 'Marketing' },
  { value: 'engineering', label: 'Engineering' },
  { value: 'operations', label: 'Operations' },
  { value: 'finance', label: 'Finance' },
  { value: 'hr', label: 'HR' },
  { value: 'customer_success', label: 'Customer Success' },
  { value: 'product', label: 'Product' },
  { value: 'legal', label: 'Legal' },
  { value: 'executive', label: 'Executive' },
];

// Same band vocabulary the signal auto-add gates use (public.signal_employee_band /
// signal_revenue_band). One spelling of "51-200" in the product, no mapping layer.
export const EMPLOYEE_BAND_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "1", label: "1 — solo" },
  { value: "2-10", label: "2–10" },
  { value: "11-50", label: "11–50" },
  { value: "51-200", label: "51–200" },
  { value: "201-500", label: "201–500" },
  { value: "501-1000", label: "501–1,000" },
  { value: "1001-5000", label: "1,001–5,000" },
  { value: "5001+", label: "5,001+" },
];

/**
 * Revenue bands are the provider's own strings, stored and compared verbatim
 * (public.signal_revenue_band only normalizes case and one legacy spelling).
 * Re-banding them would mean mapping ranges onto ranges they only partly cover.
 * "Above $50M" is the provider's own coarse bucket and overlaps the specific
 * bands below it — pick both if you want everything over $50M.
 */
export const REVENUE_BAND_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "Below $500k", label: "Below $500k" },
  { value: "$500k - $1M", label: "$500k – $1M" },
  { value: "$1M - $5M", label: "$1M – $5M" },
  { value: "$5M - $10M", label: "$5M – $10M" },
  { value: "$10M - $20M", label: "$10M – $20M" },
  { value: "$20M - $50M", label: "$20M – $50M" },
  { value: "Above $50M", label: "Above $50M (unspecified)" },
  { value: "$50M - $100M", label: "$50M – $100M" },
  { value: "$100M - $250M", label: "$100M – $250M" },
  { value: "$250M - $500M", label: "$250M – $500M" },
  { value: "$500M - $1B", label: "$500M – $1B" },
  { value: "$1B - $2.5B", label: "$1B – $2.5B" },
  { value: "$2.5B - $5B", label: "$2.5B – $5B" },
  { value: "Over $5B", label: "Over $5B" },
];
