import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { DETECTABLE_TECHNOLOGIES } from "@/lib/detected-technologies";

/**
 * Filter options for enrichment data filtering
 */
export interface FilterOptions {
  industries: string[];
  seniorities: string[];
  departments: string[];
  countries: string[];
  cities: string[];
  technologies: string[];
  /** Technologies/ad-pixels detected from the website (enrichment_data.detected_technologies) */
  detectedTechnologies: string[];
}

// Predefined options for seniority levels (Apollo standard values)
export const SENIORITY_OPTIONS = [
  { value: "owner", label: "Owner" },
  { value: "founder", label: "Founder" },
  { value: "c_suite", label: "C-Suite" },
  { value: "partner", label: "Partner" },
  { value: "vp", label: "VP" },
  { value: "head", label: "Head" },
  { value: "director", label: "Director" },
  { value: "manager", label: "Manager" },
  { value: "senior", label: "Senior" },
  { value: "entry", label: "Entry Level" },
  { value: "training", label: "Training" },
];

// Predefined options for department (Apollo standard values)
export const DEPARTMENT_OPTIONS = [
  { value: "engineering", label: "Engineering" },
  { value: "product_management", label: "Product Management" },
  { value: "design", label: "Design" },
  { value: "sales", label: "Sales" },
  { value: "marketing", label: "Marketing" },
  { value: "customer_success", label: "Customer Success" },
  { value: "support", label: "Support" },
  { value: "operations", label: "Operations" },
  { value: "finance", label: "Finance" },
  { value: "human_resources", label: "Human Resources" },
  { value: "legal", label: "Legal" },
  { value: "it", label: "IT" },
  { value: "data", label: "Data" },
  { value: "consulting", label: "Consulting" },
  { value: "education", label: "Education" },
  { value: "media_and_commmunication", label: "Media & Communication" },
];

// Common technologies (Apollo standard values)
export const TECHNOLOGY_OPTIONS = [
  "AWS", "Google Cloud", "Azure", "Cloudflare", "Heroku",
  "WordPress", "Shopify", "Squarespace", "Wix", "Webflow",
  "React", "Angular", "Vue.js", "Next.js", "Node.js",
  "Python", "Ruby on Rails", "Django", "PHP", "Laravel", "Java", ".NET",
  "Salesforce", "HubSpot", "Marketo", "Pardot", "Mailchimp",
  "Google Analytics", "Google Tag Manager", "Segment", "Mixpanel", "Amplitude",
  "Stripe", "PayPal", "Braintree",
  "Zendesk", "Intercom", "Drift", "Freshdesk",
  "Slack", "Jira", "Confluence", "Asana", "Monday.com", "Notion",
  "Tableau", "Power BI", "Looker",
  "Docker", "Kubernetes", "Terraform",
  "PostgreSQL", "MySQL", "MongoDB", "Redis", "Elasticsearch",
  "Twilio", "SendGrid", "Datadog", "New Relic", "Sentry",
  "Okta", "Auth0", "OneLogin",
  "Snowflake", "BigQuery", "Redshift",
  "GitHub", "GitLab", "Bitbucket",
  "Figma", "Sketch", "Adobe Creative Cloud",
  "Zoom", "Microsoft Teams", "Google Workspace", "Microsoft 365",
  "SAP", "Oracle", "Workday", "NetSuite",
];

// Predefined options for company size (Apollo standard values)
export const COMPANY_SIZE_OPTIONS = [
  { value: "1-10", label: "1-10 employees" },
  { value: "11-50", label: "11-50 employees" },
  { value: "51-200", label: "51-200 employees" },
  { value: "201-500", label: "201-500 employees" },
  { value: "501-1000", label: "501-1000 employees" },
  { value: "1001-5000", label: "1001-5000 employees" },
  { value: "5001-10000", label: "5001-10000 employees" },
  { value: "10000+", label: "10000+ employees" },
];

/**
 * Deduplicate string values by lowercase key, keeping the first-seen variant.
 * Since all filters use case-insensitive matching (ilike / LOWER), we only
 * need one representative value per unique lowercase key in the dropdown.
 */
function deduplicateByLowercase(values: Set<string>): string[] {
  const seen = new Map<string, string>();
  for (const v of values) {
    const key = v.toLowerCase();
    if (!seen.has(key)) {
      seen.set(key, v);
    }
  }
  return Array.from(seen.values());
}

/**
 * Hook to fetch distinct filter options from the organization's contacts
 * This enables dynamic dropdown options based on actual data
 */
export function useFilterOptions() {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["filter-options", currentOrganization?.id],
    queryFn: async (): Promise<FilterOptions> => {
      if (!currentOrganization?.id) {
        return {
          industries: [],
          seniorities: [],
          departments: [],
          countries: [],
          cities: [],
          technologies: [],
          detectedTechnologies: [],
        };
      }

      // Fetch contacts with enrichment data. `order` is required here: an
      // unordered `.limit(5000)` on a large org (774k+ rows) can't use
      // idx_crm_contacts_org_first_seen to short-circuit, so Postgres scans
      // far more of the table than 5000 rows and blows the 8s statement
      // timeout. Ordering by the same indexed column keeps this a bounded
      // index scan regardless of org size (~250ms worst case observed on a
      // 774k-row org, vs. 5-11s/timeout unordered).
      const { data: contacts, error } = await supabase
        .from("crm_contacts")
        .select("enrichment_data, country, city")
        .eq("organization_id", currentOrganization.id)
        .not("enrichment_data", "is", null)
        .order("first_seen_at", { ascending: false })
        .limit(5000); // Reasonable limit for option extraction

      if (error) {
        console.error("Error fetching filter options:", error);
        throw error;
      }

      // Extract unique values from contacts
      const industries = new Set<string>();
      const seniorities = new Set<string>();
      const departments = new Set<string>();
      const countries = new Set<string>();
      const cities = new Set<string>();
      const technologies = new Set<string>();
      const detectedTechnologies = new Set<string>();

      for (const contact of contacts || []) {
        const enrichment = contact.enrichment_data as Record<string, unknown> | null;

        if (enrichment) {
          const company = enrichment.company as Record<string, unknown> | undefined;

          const detected = enrichment.detected_technologies as { all?: unknown } | undefined;
          if (detected?.all && Array.isArray(detected.all)) {
            for (const tech of detected.all) {
              if (typeof tech === "string") detectedTechnologies.add(tech);
            }
          }

          if (company?.industry && typeof company.industry === "string") {
            industries.add(company.industry);
          }
          if (enrichment.seniority && typeof enrichment.seniority === "string") {
            seniorities.add(enrichment.seniority);
          }
          if (enrichment.department && typeof enrichment.department === "string") {
            departments.add(enrichment.department);
          }
          if (company?.technologies && Array.isArray(company.technologies)) {
            for (const tech of company.technologies) {
              if (typeof tech === "string") {
                technologies.add(tech);
              }
            }
          }
        }

        if (contact.country) {
          countries.add(contact.country);
        }
        if (contact.city) {
          cities.add(contact.city);
        }
      }

      return {
        industries: deduplicateByLowercase(industries).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })),
        seniorities: deduplicateByLowercase(seniorities).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })),
        departments: deduplicateByLowercase(departments).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })),
        countries: deduplicateByLowercase(countries).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })),
        cities: deduplicateByLowercase(cities).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })),
        technologies: deduplicateByLowercase(technologies).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })),
        // Always offer the full catalog of detectable technologies (plus any extra
        // values actually found in the data), so the filter is usable before many
        // leads are analyzed.
        detectedTechnologies: deduplicateByLowercase(
          new Set<string>([...DETECTABLE_TECHNOLOGIES, ...detectedTechnologies])
        ).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })),
      };
    },
    enabled: !!currentOrganization?.id,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    gcTime: 10 * 60 * 1000, // Keep in cache for 10 minutes
  });
}

/** Known seniority display labels (keyed by lowercase) */
const SENIORITY_LABELS: Record<string, string> = {
  "owner": "Owner",
  "founder": "Founder",
  "c_suite": "C-Suite",
  "c suite": "C-Suite",
  "partner": "Partner",
  "vp": "VP",
  "head": "Head",
  "director": "Director",
  "manager": "Manager",
  "senior": "Senior",
  "entry": "Entry Level",
  "training": "Training",
};

/**
 * Format seniority value for display
 */
export function formatSeniority(value: string): string {
  // Try exact match first, then lowercase match
  const label = SENIORITY_LABELS[value] || SENIORITY_LABELS[value.toLowerCase()];
  if (label) return label;

  // Fallback: convert snake_case to Title Case
  return value
    .replace(/_/g, " ")
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

/** Known department display labels (keyed by lowercase) */
const DEPARTMENT_LABELS: Record<string, string> = {
  "engineering": "Engineering",
  "master_engineering_technical": "Engineering",
  "product_management": "Product Management",
  "design": "Design",
  "sales": "Sales",
  "master_sales": "Sales",
  "marketing": "Marketing",
  "master_marketing": "Marketing",
  "customer_success": "Customer Success",
  "support": "Support",
  "operations": "Operations",
  "master_operations": "Operations",
  "finance": "Finance",
  "master_finance": "Finance",
  "human_resources": "Human Resources",
  "master_human_resources": "Human Resources",
  "legal": "Legal",
  "it": "IT",
  "master_information_technology": "IT",
  "data": "Data",
  "consulting": "Consulting",
  "education": "Education",
  "media_and_commmunication": "Media & Communication",
  "media_and_communication": "Media & Communication",
  "c_suite": "C-Suite",
};

/**
 * Format department value for display
 */
export function formatDepartment(value: string): string {
  const label = DEPARTMENT_LABELS[value] || DEPARTMENT_LABELS[value.toLowerCase()];
  if (label) return label;

  // Fallback: strip "master_" prefix, convert snake_case to Title Case
  return value
    .replace(/^master_/, "")
    .replace(/_/g, " ")
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}
