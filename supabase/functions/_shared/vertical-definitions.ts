// ============================================================================
// vertical-definitions.ts
// ----------------------------------------------------------------------------
// Curated niche → query mapping for the lead pool. Each entry knows:
//   - which SIC codes Apollo uses for this vertical (often multiple)
//   - which company-name / title keywords to match
//   - how to combine them: AND for precise verticals, OR for fragmented ones
//
// Why this exists: Apollo's classification is uneven. Some niches map to one
// clean SIC (restaurants → 5812). Others scatter across 20+ codes (HVAC has
// real companies tagged as 'Wholesale Durable Goods', 'Electrical Work',
// 'Auto Repair', and 3,000+ with NULL sic). Forcing the user to pick a SIC
// loses 80%+ of HVAC leads. Forcing them to type the right keyword string
// is also unreasonable. So we encode the mapping once.
//
// SIC code list here was derived empirically from the lead pool — for each
// vertical we ran `SELECT p_sic, count(*) FROM lead_pool WHERE company ILIKE
// '%hvac%' GROUP BY p_sic ORDER BY count DESC` and took the SICs covering
// >95% of matched companies.
// ============================================================================

export type MatchCombinator = "and" | "or" | "sic_only" | "keyword_only";

export interface VerticalDefinition {
  slug: string;
  label: string;
  description: string;
  sic_codes: string[];
  keywords: string[];
  // and: row must match a SIC AND a keyword (max precision, smaller pool)
  // or: row must match a SIC OR a keyword (max recall, used when SIC
  //     classification is fragmented or NULL-heavy)
  // sic_only: SIC list alone (Apollo classifies cleanly, keyword adds noise)
  // keyword_only: keyword alone (Apollo's SIC for this niche is useless)
  // industry_only: match against a single Apollo p_industry slug. Used
  //     when neither SIC nor keyword captures the niche — the slug is
  //     uniquely scoped (e.g. 'automobiles_and_other_motor_vehicles' is
  //     just dealerships, no false positives, no scan cost).
  match: MatchCombinator | "industry_only";
  // Apollo p_industry slug. Required when match='industry_only', optional
  // otherwise. Cheaper than keyword scans because it's an indexed equality.
  industry_exact?: string;
  // Free-text aliases for fuzzy matching when the user types a niche name
  // ("plumber" should resolve to the "plumbing" definition).
  aliases?: string[];
}

export const VERTICAL_DEFINITIONS: VerticalDefinition[] = [
  // -------------------------------------------------------------------------
  // Trades — most are Apollo-fragmented, hence "or" with broad SIC + keyword
  // -------------------------------------------------------------------------
  {
    slug: "hvac",
    label: "HVAC contractors",
    description: "Heating, ventilation, air conditioning, refrigeration",
    // Apollo classifies HVAC across 20+ SICs (manufacturing, wholesale,
    // service, real estate, even auto repair) plus 3,000+ rows with NULL
    // sic. Keyword-only on company/domain captures ~14k senior midmarket
    // leads vs only ~2k with any SIC combo. SIC actively hurts here.
    sic_codes: [],
    keywords: ["HVAC", "heating", "air conditioning", "cooling", "refrigeration"],
    match: "keyword_only",
    aliases: ["heating", "ac", "air conditioning", "cooling"],
  },
  {
    slug: "plumbing",
    label: "Plumbing contractors",
    description: "Plumbing services and supply",
    // Same Apollo-fragmentation problem as HVAC — keyword-only is more
    // inclusive than any SIC combo for this niche.
    sic_codes: [],
    keywords: ["plumb", "plumber", "plumbing"],
    match: "keyword_only",
    aliases: ["plumber"],
  },
  {
    slug: "electrical",
    label: "Electrical contractors",
    description: "Electrical work, wiring, installations",
    sic_codes: ["1731"],
    keywords: ["electrician", "electrical", "wiring"],
    match: "sic_only",
    aliases: ["electrician"],
  },
  {
    slug: "roofing",
    label: "Roofing contractors",
    description: "Residential and commercial roofing",
    sic_codes: ["1761", "1799"],
    keywords: ["roof", "roofing", "roofer"],
    match: "or",
    aliases: ["roofer"],
  },
  {
    slug: "drywall",
    label: "Drywall and plastering",
    description: "Plastering, drywall, insulation",
    sic_codes: ["1742"],
    keywords: ["drywall", "plaster", "insulation"],
    match: "sic_only",
  },
  {
    slug: "masonry",
    label: "Masonry contractors",
    description: "Brick, stone, masonry work",
    sic_codes: ["1741"],
    keywords: ["masonry", "mason", "brick", "stonework"],
    match: "sic_only",
  },
  {
    slug: "concrete",
    label: "Concrete contractors",
    description: "Concrete work, foundations, paving",
    sic_codes: ["1771"],
    keywords: ["concrete", "paving"],
    match: "sic_only",
  },
  {
    slug: "painting",
    label: "Painting contractors",
    description: "Residential and commercial painting",
    sic_codes: ["1721"],
    keywords: ["painting", "painter"],
    match: "sic_only",
    aliases: ["painter"],
  },
  {
    slug: "landscaping",
    label: "Landscaping companies",
    description: "Landscape services, lawn care, gardening",
    sic_codes: ["0782", "0783", "0781"],
    keywords: ["landscap", "lawn care", "gardening"],
    match: "or",
    aliases: ["landscaper", "lawn"],
  },
  {
    slug: "general_contractor",
    label: "General contractors",
    description: "Residential and commercial general contracting",
    sic_codes: ["1521", "1522", "1541", "1542"],
    keywords: ["general contractor", "construction"],
    match: "or",
    aliases: ["construction"],
  },

  // -------------------------------------------------------------------------
  // Professional services — Apollo classifies these cleanly
  // -------------------------------------------------------------------------
  {
    slug: "law_firms",
    label: "Law firms",
    description: "Legal services, attorneys, lawyers",
    sic_codes: ["8111"],
    keywords: ["law firm", "attorney", "lawyer", "legal"],
    match: "sic_only",
    aliases: ["legal", "lawyers", "attorneys"],
  },
  {
    slug: "accounting",
    label: "Accounting firms",
    description: "Accounting, bookkeeping, tax preparation",
    sic_codes: ["8721"],
    keywords: ["accounting", "CPA", "bookkeeping", "tax"],
    match: "sic_only",
    aliases: ["accountants", "cpa", "bookkeeper"],
  },
  {
    slug: "consulting",
    label: "Management consulting",
    description: "Strategy, ops, and management consulting",
    sic_codes: ["8742", "8748"],
    keywords: ["consulting", "consultant"],
    match: "sic_only",
    aliases: ["consultants"],
  },
  {
    slug: "engineering",
    label: "Engineering firms",
    description: "Engineering services, design, planning",
    sic_codes: ["8711"],
    keywords: ["engineering"],
    match: "sic_only",
  },
  {
    slug: "architecture",
    label: "Architecture firms",
    description: "Architectural design and planning",
    sic_codes: ["8712"],
    keywords: ["architecture", "architect"],
    match: "sic_only",
    aliases: ["architects"],
  },
  {
    slug: "marketing_agency",
    label: "Marketing & advertising agencies",
    description: "Advertising, PR, digital marketing",
    sic_codes: ["7311", "8742"],
    keywords: ["marketing", "advertising", "agency", "PR"],
    match: "or",
    aliases: ["ad agency", "advertising", "agencies"],
  },

  // -------------------------------------------------------------------------
  // Healthcare
  // -------------------------------------------------------------------------
  {
    slug: "medical_practice",
    label: "Medical practices",
    description: "Doctors offices, family medicine",
    sic_codes: ["8011", "8049"],
    keywords: ["medical", "doctor", "physician", "clinic"],
    match: "sic_only",
    aliases: ["doctors", "physicians", "clinics"],
  },
  {
    slug: "dental",
    label: "Dental practices",
    description: "Dentists, orthodontists, oral surgeons",
    sic_codes: ["8021"],
    keywords: ["dental", "dentist", "orthodontic"],
    match: "or",
    aliases: ["dentists", "dentistry"],
  },
  {
    slug: "veterinary",
    label: "Veterinary practices",
    description: "Animal hospitals, vet clinics",
    sic_codes: ["0742"],
    keywords: ["veterinary", "vet", "animal hospital"],
    match: "or",
    aliases: ["vet"],
  },
  {
    slug: "chiropractic",
    label: "Chiropractic offices",
    description: "Chiropractors, physical therapy",
    sic_codes: ["8041", "8049"],
    keywords: ["chiropract"],
    match: "or",
    aliases: ["chiropractor"],
  },
  {
    slug: "home_health",
    label: "Home health & senior care",
    description: "Home health, nursing, senior care services",
    sic_codes: ["8082", "8059", "8051"],
    keywords: ["home health", "senior care", "nursing", "assisted living"],
    match: "or",
  },

  // -------------------------------------------------------------------------
  // Tech / digital
  // -------------------------------------------------------------------------
  {
    slug: "software",
    label: "Software / SaaS companies",
    description: "Software publishers, SaaS, app developers",
    sic_codes: ["7372", "7371"],
    keywords: ["software", "SaaS", "platform", "app"],
    match: "sic_only",
    aliases: ["saas", "tech"],
  },
  {
    slug: "it_services",
    label: "IT services & MSPs",
    description: "IT support, managed services, system integrators",
    sic_codes: ["7379", "7371", "7373"],
    keywords: ["IT services", "MSP", "managed service"],
    match: "or",
    aliases: ["msp", "it support"],
  },
  {
    slug: "cybersecurity",
    label: "Cybersecurity firms",
    description: "Security software, pen testing, SOC",
    sic_codes: ["7372", "7379"],
    keywords: ["cybersecurity", "security", "infosec", "SOC"],
    match: "or",
    aliases: ["infosec", "security firm"],
  },

  // -------------------------------------------------------------------------
  // F&B / hospitality
  // -------------------------------------------------------------------------
  {
    slug: "restaurants",
    label: "Restaurants",
    description: "Eating places, dining, food service",
    sic_codes: ["5812"],
    keywords: ["restaurant", "dining"],
    match: "sic_only",
    aliases: ["dining"],
  },
  {
    slug: "hotels",
    label: "Hotels & lodging",
    description: "Hotels, motels, resorts",
    sic_codes: ["7011"],
    keywords: ["hotel", "resort", "lodging"],
    match: "sic_only",
    aliases: ["lodging"],
  },

  // -------------------------------------------------------------------------
  // Real estate
  // -------------------------------------------------------------------------
  {
    slug: "real_estate",
    label: "Real estate agents & brokerages",
    description: "Real estate sales agents, brokers",
    sic_codes: ["6531"],
    keywords: ["real estate", "realtor", "broker"],
    match: "sic_only",
    aliases: ["realtor", "brokerage"],
  },
  {
    slug: "property_management",
    label: "Property management",
    description: "Residential and commercial property management",
    sic_codes: ["6512", "6513", "6531"],
    keywords: ["property management", "property manager"],
    match: "or",
  },

  // -------------------------------------------------------------------------
  // Other
  // -------------------------------------------------------------------------
  {
    slug: "trucking",
    label: "Trucking & logistics",
    description: "Trucking, freight, logistics",
    sic_codes: ["4213", "4731", "4225"],
    keywords: ["trucking", "freight", "logistics"],
    match: "or",
    aliases: ["freight", "logistics"],
  },
  {
    slug: "insurance",
    label: "Insurance agents & brokers",
    description: "Insurance agencies, brokers, services",
    sic_codes: ["6411", "6311", "6321"],
    keywords: ["insurance"],
    match: "sic_only",
  },
  {
    slug: "auto_repair",
    label: "Auto repair shops",
    description: "Automotive repair and service",
    sic_codes: ["7538", "7539", "7532"],
    keywords: ["auto repair", "automotive", "mechanic"],
    match: "sic_only",
    aliases: ["mechanic", "automotive"],
  },
  {
    // Apollo doesn't populate the standard SIC 5511/5521 codes —
    // dealerships land on `p_industry='automobiles_and_other_motor_vehicles'`
    // (~173k rows, 2.8k verified-email decision-makers). The matching
    // p_sic values are scattered across 5012 (wholesale), 5531 (auto+home
    // supply), 8732 (commercial research), etc., none of them clean
    // enough to filter by SIC alone. Industry slug is the clean cut.
    slug: "auto_dealers",
    label: "Auto dealerships",
    description: "New and used car dealers",
    sic_codes: [],
    keywords: ["auto dealer", "car dealer", "dealership"],
    industry_exact: "automobiles_and_other_motor_vehicles",
    match: "industry_only",
    aliases: ["car dealer", "dealership"],
  },
  {
    slug: "fitness",
    label: "Gyms & fitness studios",
    description: "Health clubs, gyms, yoga, personal training",
    sic_codes: ["7991", "7997"],
    keywords: ["gym", "fitness", "yoga", "pilates"],
    match: "or",
    aliases: ["gym", "yoga"],
  },
];

// Quick lookup index keyed by slug AND aliases (lowercased).
const INDEX = (() => {
  const map = new Map<string, VerticalDefinition>();
  for (const v of VERTICAL_DEFINITIONS) {
    map.set(v.slug.toLowerCase(), v);
    for (const alias of v.aliases ?? []) {
      map.set(alias.toLowerCase(), v);
    }
    map.set(v.label.toLowerCase(), v);
  }
  return map;
})();

export function findVertical(query: string): VerticalDefinition | null {
  if (!query) return null;
  const key = query.trim().toLowerCase();
  return INDEX.get(key) ?? null;
}
