/**
 * Adapter between the smart-list stored shape (SmartListFilterCriteria,
 * snake_case — consumed by the server-side membership core
 * smart_list_eligible_contacts_for_criteria) and the shared AdvancedFilters
 * panel shape (EnrichmentFilters, camelCase).
 *
 * The stored shape is the source of truth and stays snake_case. This bridges
 * the ENRICHMENT / qualification fields the panel exposes. CRM-context fields
 * (source/status/tags/pipeline/dates/score/has_email/has_linkedin) and signal
 * fields are handled by the builder's own controls and are never touched here.
 */
import type { SmartListFilterCriteria } from "@/hooks/useLeadLists";
import type { EnrichmentFilters } from "@/types/enrichment-filters";

/** Only `hasEmail` is hidden — the builder owns has_email (paired with the
 *  has_linkedin control the panel has no equivalent for). Every other panel
 *  field is now evaluated by the smart-list membership core. */
export const SMARTLIST_HIDDEN_FIELDS: ReadonlyArray<keyof EnrichmentFilters> = [
  "hasEmail",
];

/** SmartListFilterCriteria (stored) → EnrichmentFilters (panel display). */
export function criteriaToEnrichment(c: SmartListFilterCriteria): EnrichmentFilters {
  const ef: EnrichmentFilters = {};
  if (c.industries?.length) ef.industries = c.industries;
  if (c.company_sizes?.length) ef.companySizes = c.company_sizes;
  if (c.min_employee_count !== undefined) ef.minEmployeeCount = c.min_employee_count;
  if (c.max_employee_count !== undefined) ef.maxEmployeeCount = c.max_employee_count;
  if (c.seniorities?.length) ef.seniorities = c.seniorities;
  if (c.departments?.length) ef.departments = c.departments;
  if (c.technologies?.length) ef.technologies = c.technologies;
  if (c.email_verified !== undefined) ef.emailVerified = c.email_verified;
  if (c.email_quality?.length) ef.emailQuality = c.email_quality;
  if (c.min_email_confidence !== undefined) ef.minEmailConfidence = c.min_email_confidence;
  if (c.email_type) ef.emailType = c.email_type;
  if (c.countries?.length) ef.countries = c.countries;
  if (c.cities?.length) ef.cities = c.cities;
  if (c.has_enrichment_data !== undefined) ef.hasEnrichmentData = c.has_enrichment_data;
  if (c.icp_product_id) ef.icpProductId = c.icp_product_id;
  if (c.min_icp_score !== undefined) ef.minIcpScore = c.min_icp_score;
  if (c.max_icp_score !== undefined) ef.maxIcpScore = c.max_icp_score;
  if (c.min_dm_score !== undefined) ef.minDmScore = c.min_dm_score;
  if (c.max_dm_score !== undefined) ef.maxDmScore = c.max_dm_score;
  if (c.is_b2b !== undefined) ef.isB2b = c.is_b2b;
  if (c.revenue_models?.length) ef.revenueModels = c.revenue_models;
  if (c.has_outbound_motion !== undefined) ef.hasOutboundMotion = c.has_outbound_motion;
  if (c.hiring_sales_roles !== undefined) ef.hiringSalesRoles = c.hiring_sales_roles;
  if (c.runs_ads !== undefined) ef.runsAds = c.runs_ads;
  if (c.detected_technologies?.length) ef.detectedTechnologies = c.detected_technologies;
  if (c.detected_tech_match_all !== undefined) ef.detectedTechMatchAll = c.detected_tech_match_all;
  if (c.excluded_technologies?.length) ef.excludedTechnologies = c.excluded_technologies;
  if (c.custom_questions?.length) ef.customQuestions = c.custom_questions;
  if (c.custom_field_conditions?.length) ef.customFieldConditions = c.custom_field_conditions;
  if (c.has_notion_url !== undefined) ef.hasNotionUrl = c.has_notion_url;
  if (c.seg_firewall) ef.segFirewall = c.seg_firewall;
  if (c.ai_analysis_status) ef.aiAnalysisStatus = c.ai_analysis_status;
  return ef;
}

/**
 * Merge a new EnrichmentFilters from the panel back into existing criteria,
 * touching ONLY the mapped enrichment keys (all other criteria — source,
 * status, tags, pipeline, dates, signals, has_email, etc. — are preserved).
 * A key absent from `ef` is removed from the criteria (the panel cleared it).
 */
export function mergeEnrichmentIntoCriteria(
  base: SmartListFilterCriteria,
  ef: EnrichmentFilters,
): SmartListFilterCriteria {
  const next: SmartListFilterCriteria = { ...base };

  const setOrDelete = <K extends keyof SmartListFilterCriteria>(
    key: K,
    value: SmartListFilterCriteria[K] | undefined,
  ) => {
    if (value === undefined || (Array.isArray(value) && value.length === 0)) {
      delete next[key];
    } else {
      next[key] = value;
    }
  };

  setOrDelete("industries", ef.industries);
  setOrDelete("company_sizes", ef.companySizes);
  setOrDelete("min_employee_count", ef.minEmployeeCount);
  setOrDelete("max_employee_count", ef.maxEmployeeCount);
  setOrDelete("seniorities", ef.seniorities);
  setOrDelete("departments", ef.departments);
  setOrDelete("technologies", ef.technologies);
  setOrDelete("email_verified", ef.emailVerified);
  setOrDelete("email_quality", ef.emailQuality);
  setOrDelete("min_email_confidence", ef.minEmailConfidence);
  setOrDelete("email_type", ef.emailType);
  setOrDelete("countries", ef.countries);
  setOrDelete("cities", ef.cities);
  setOrDelete("has_enrichment_data", ef.hasEnrichmentData);
  setOrDelete("icp_product_id", ef.icpProductId);
  setOrDelete("min_icp_score", ef.minIcpScore);
  setOrDelete("max_icp_score", ef.maxIcpScore);
  setOrDelete("min_dm_score", ef.minDmScore);
  setOrDelete("max_dm_score", ef.maxDmScore);
  setOrDelete("is_b2b", ef.isB2b);
  setOrDelete("revenue_models", ef.revenueModels);
  setOrDelete("has_outbound_motion", ef.hasOutboundMotion);
  setOrDelete("hiring_sales_roles", ef.hiringSalesRoles);
  setOrDelete("runs_ads", ef.runsAds);
  setOrDelete("detected_technologies", ef.detectedTechnologies);
  setOrDelete("detected_tech_match_all", ef.detectedTechMatchAll);
  setOrDelete("excluded_technologies", ef.excludedTechnologies);
  setOrDelete("custom_questions", ef.customQuestions);
  setOrDelete("custom_field_conditions", ef.customFieldConditions);
  setOrDelete("has_notion_url", ef.hasNotionUrl);
  setOrDelete("seg_firewall", ef.segFirewall);
  setOrDelete("ai_analysis_status", ef.aiAnalysisStatus);

  return next;
}
