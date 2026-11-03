import type { SegmentRule, SegmentRuleField, SegmentRuleGroup, SegmentRuleOperator, SmartListFilterCriteria } from "@/hooks/useLeadLists";

export const SEGMENT_FIELD_GROUPS: Array<{ group: string; items: Array<{ value: SegmentRuleField; label: string }> }> = [
  { group: "Basics", items: [
    { value: 'source', label: 'Contact source' }, { value: 'status', label: 'Contact status' },
    { value: 'tag', label: 'Tag' }, { value: 'lead_score', label: 'Lead score' },
    { value: 'has_email', label: 'Email address' }, { value: 'has_linkedin', label: 'LinkedIn URL' },
    { value: 'country', label: 'Country' }, { value: 'city', label: 'City' }, { value: 'custom_field', label: 'Custom field' },
  ] },
  { group: "Firmographics", items: [
    { value: 'industry', label: 'Industry' }, { value: 'company_size', label: 'Company size' },
    { value: 'company_employee_count', label: 'Employee count' }, { value: 'seniority', label: 'Seniority' },
    { value: 'department', label: 'Department' }, { value: 'technology', label: 'Technology used' },
    { value: 'detected_technology', label: 'Detected on website' }, { value: 'revenue_model', label: 'Revenue model' },
    { value: 'is_b2b', label: 'Is B2B' }, { value: 'has_outbound_motion', label: 'Has outbound motion' },
    { value: 'hiring_sales_roles', label: 'Hiring sales roles' }, { value: 'runs_ads', label: 'Runs paid ads' },
  ] },
  { group: "Email quality", items: [
    { value: 'email_quality', label: 'Email quality' }, { value: 'email_type', label: 'Email type' },
    { value: 'min_email_confidence', label: 'Email confidence' }, { value: 'email_verified', label: 'Email verified' },
  ] },
  { group: "CRM & pipeline", items: [
    { value: 'pipeline_id', label: 'Pipeline' }, { value: 'stage_id', label: 'Pipeline stage' }, { value: 'owner_user_id', label: 'Owner' },
    { value: 'created_days_ago', label: 'Created within (days)' }, { value: 'activity_days_ago', label: 'Active within (days)' },
  ] },
  { group: "Qualification", items: [
    { value: 'icp_score', label: 'ICP score' }, { value: 'dm_score', label: 'Decision-maker score' },
    { value: 'custom_question', label: 'AI custom question' },
  ] },
  { group: "Data & compliance", items: [
    { value: 'has_enrichment_data', label: 'Enrichment data' }, { value: 'has_notion_url', label: 'Notion page' },
    { value: 'seg_firewall', label: 'SEG firewall' }, { value: 'ai_analysis_status', label: 'AI analysis status' },
  ] },
  { group: "Discovery", items: [
    { value: 'signal', label: 'Discovered by signal' },
  ] },
];

export const SEGMENT_OPERATORS: Record<SegmentRuleField, Array<{ value: SegmentRuleOperator; label: string }>> = {
  source: [{ value: 'is', label: 'is' }, { value: 'is_not', label: 'is not' }],
  status: [{ value: 'is', label: 'is' }, { value: 'is_not', label: 'is not' }],
  tag: [{ value: 'has_any', label: 'has any of' }, { value: 'has_all', label: 'has all of' }, { value: 'has_none', label: 'has none of' }],
  lead_score: [{ value: 'gte', label: 'is at least' }, { value: 'lte', label: 'is at most' }],
  has_email: [{ value: 'exists', label: 'exists' }, { value: 'not_exists', label: 'does not exist' }],
  has_linkedin: [{ value: 'exists', label: 'exists' }, { value: 'not_exists', label: 'does not exist' }],
  country: [{ value: 'is', label: 'is' }, { value: 'is_not', label: 'is not' }],
  city: [{ value: 'is', label: 'is' }, { value: 'is_not', label: 'is not' }],
  custom_field: [{ value: 'equals', label: 'equals' }, { value: 'contains', label: 'contains' }, { value: 'exists', label: 'has a value' }, { value: 'is_empty', label: 'is empty' }],
  signal: [{ value: 'is', label: 'is' }, { value: 'is_not', label: 'is not' }],
  company_employee_count: [{ value: 'gte', label: 'is at least' }, { value: 'lte', label: 'is at most' }, { value: 'equals', label: 'equals' }],
  company_size: [{ value: 'is', label: 'is any of' }],
  pipeline_id: [{ value: 'is', label: 'is' }, { value: 'is_not', label: 'is not' }],
  stage_id: [{ value: 'is', label: 'is' }, { value: 'is_not', label: 'is not' }],
  owner_user_id: [{ value: 'is', label: 'is' }, { value: 'is_not', label: 'is not' }],
  created_days_ago: [{ value: 'within', label: 'is within' }],
  activity_days_ago: [{ value: 'within', label: 'is within' }],
  icp_score: [{ value: 'gte', label: 'is at least' }, { value: 'lte', label: 'is at most' }],
  dm_score: [{ value: 'gte', label: 'is at least' }, { value: 'lte', label: 'is at most' }],
  custom_question: [{ value: 'gte', label: 'has answered' }],
  industry: [{ value: 'in', label: 'is any of' }, { value: 'not_in', label: 'is none of' }],
  seniority: [{ value: 'in', label: 'is any of' }, { value: 'not_in', label: 'is none of' }],
  department: [{ value: 'in', label: 'is any of' }, { value: 'not_in', label: 'is none of' }],
  revenue_model: [{ value: 'in', label: 'is any of' }, { value: 'not_in', label: 'is none of' }],
  technology: [{ value: 'has_any', label: 'has any of' }, { value: 'has_all', label: 'has all of' }, { value: 'has_none', label: 'has none of' }],
  detected_technology: [{ value: 'has_any', label: 'has any of' }, { value: 'has_all', label: 'has all of' }, { value: 'has_none', label: 'has none of' }],
  is_b2b: [{ value: 'is', label: 'is' }],
  has_outbound_motion: [{ value: 'is', label: 'is' }],
  hiring_sales_roles: [{ value: 'is', label: 'is' }],
  runs_ads: [{ value: 'is', label: 'is' }],
  email_quality: [{ value: 'in', label: 'is any of' }, { value: 'not_in', label: 'is none of' }],
  email_type: [{ value: 'is', label: 'is' }, { value: 'is_not', label: 'is not' }],
  min_email_confidence: [{ value: 'gte', label: 'is at least' }],
  email_verified: [{ value: 'is', label: 'is' }],
  has_enrichment_data: [{ value: 'exists', label: 'exists' }, { value: 'not_exists', label: 'does not exist' }],
  has_notion_url: [{ value: 'exists', label: 'exists' }, { value: 'not_exists', label: 'does not exist' }],
  seg_firewall: [{ value: 'is', label: 'is' }],
  ai_analysis_status: [{ value: 'is', label: 'is' }],
};

export interface SegmentValidationIssue { ruleId: string; message: string; }

const FIELD_LABELS = Object.fromEntries(SEGMENT_FIELD_GROUPS.flatMap((group) => group.items.map((field) => [field.value, field.label]))) as Record<SegmentRuleField, string>;
const NUMERIC_FIELDS = new Set<SegmentRuleField>(['lead_score', 'company_employee_count', 'created_days_ago', 'activity_days_ago', 'min_email_confidence', 'icp_score', 'dm_score', 'custom_question']);
const MULTI_FIELDS = new Set<SegmentRuleField>(['tag', 'industry', 'seniority', 'department', 'technology', 'detected_technology', 'company_size', 'revenue_model', 'email_quality']);
const SCORE_FIELDS = new Set<SegmentRuleField>(['lead_score', 'min_email_confidence', 'icp_score', 'dm_score']);
const UUID_FIELDS = new Set<SegmentRuleField>(['pipeline_id', 'stage_id', 'owner_user_id', 'signal']);
const BOOLEAN_FIELDS = new Set<SegmentRuleField>(['is_b2b', 'has_outbound_motion', 'hiring_sales_roles', 'runs_ads', 'email_verified']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isSegmentRuleGroup(node: SegmentRule | SegmentRuleGroup): node is SegmentRuleGroup {
  return 'rules' in node;
}

/** Validate before previewing or saving: malformed input can otherwise become a silent zero-match audience. */
export function validateSegmentRule(rule: SegmentRule): string | null {
  const label = FIELD_LABELS[rule.field] ?? 'Rule';
  if (!SEGMENT_OPERATORS[rule.field]?.some((operator) => operator.value === rule.operator)) return `${label}: choose a valid condition.`;
  if (rule.field === 'custom_field' && !rule.fieldKey?.trim()) return 'Custom field: choose a field.';
  if (rule.field === 'custom_question' && !rule.fieldKey?.trim()) return 'AI custom question: choose a question.';
  if (['icp_score', 'dm_score'].includes(rule.field) && !UUID.test(rule.fieldKey || '')) return `${label}: choose a product.`;
  if (['exists', 'not_exists', 'is_empty'].includes(rule.operator)) return null;
  if (rule.field === 'custom_question' && (rule.value === undefined || String(rule.value).trim() === '')) return null;
  if (MULTI_FIELDS.has(rule.field)) {
    return Array.isArray(rule.value) && rule.value.length > 0 && rule.value.every((value) => value.trim()) ? null : `${label}: select at least one value.`;
  }
  if (rule.value === undefined || rule.value === null || String(rule.value).trim() === '') return `${label}: enter or select a value.`;
  if (BOOLEAN_FIELDS.has(rule.field) && ![true, false, 'true', 'false'].includes(rule.value as boolean | string)) return `${label}: choose yes or no.`;
  if (UUID_FIELDS.has(rule.field) && !UUID.test(String(rule.value))) return `${label}: choose an available value.`;
  if (NUMERIC_FIELDS.has(rule.field)) {
    const value = Number(rule.value);
    const numberPattern = rule.field === 'custom_question' ? /^[0-9]+(\.[0-9]+)?$/ : /^[0-9]+$/;
    if (!numberPattern.test(String(rule.value)) || !Number.isFinite(value) || value < 0 || (rule.field !== 'custom_question' && !Number.isInteger(value))) return `${label}: enter a ${rule.field === 'custom_question' ? 'number' : 'whole number'} of zero or more.`;
    if (SCORE_FIELDS.has(rule.field) && value > 100) return `${label}: enter a value between 0 and 100.`;
    if (['created_days_ago', 'activity_days_ago'].includes(rule.field) && value < 1) return `${label}: enter at least 1 day.`;
    if (value > 2147483647) return `${label}: enter a smaller value.`;
  }
  return null;
}

export function validateSmartSegmentCriteria(criteria: SmartListFilterCriteria): SegmentValidationIssue[] {
  if (criteria.rule_group) {
    const issues: SegmentValidationIssue[] = [];
    const visit = (group: SegmentRuleGroup, depth: number) => {
      if (depth > 8) { issues.push({ ruleId: group.id, message: 'Use fewer nested rule groups (8 levels maximum).' }); return; }
      if (!group.rules.length) issues.push({ ruleId: group.id, message: depth ? 'Add a rule to this group or remove the empty group.' : 'Add a rule or choose an audience starter.' });
      if (!['and', 'or'].includes(group.operator)) issues.push({ ruleId: group.id, message: 'Choose whether people must match all or any rules.' });
      for (const rule of group.rules) {
        if (isSegmentRuleGroup(rule)) visit(rule, depth + 1);
        else { const message = validateSegmentRule(rule); if (message) issues.push({ ruleId: rule.id, message }); }
      }
    };
    visit(criteria.rule_group, 0);
    return issues;
  }
  const entries = Object.entries(criteria).filter(([, value]) => value !== undefined && value !== '' && (!Array.isArray(value) || value.length > 0));
  if (!entries.length) return [{ ruleId: 'criteria', message: 'Choose at least one audience rule.' }];
  const issues: SegmentValidationIssue[] = [];
  for (const [key, value] of entries) {
    if (typeof value === 'number' && (!Number.isFinite(value) || value < 0)) issues.push({ ruleId: key, message: `${key.replaceAll('_', ' ')}: enter a valid positive number.` });
  }
  for (const [min, max] of [['min_score', 'max_score'], ['min_employee_count', 'max_employee_count'], ['min_icp_score', 'max_icp_score'], ['min_dm_score', 'max_dm_score']] as const) {
    if (criteria[min] !== undefined && criteria[max] !== undefined && criteria[min]! > criteria[max]!) issues.push({ ruleId: min, message: 'The minimum must be less than or equal to the maximum.' });
  }
  return issues;
}

export function countSmartSegmentRules(criteria: SmartListFilterCriteria): number {
  const count = (group: SegmentRuleGroup): number => group.rules.reduce((total, node) => total + (isSegmentRuleGroup(node) ? count(node) : 1), 0);
  return criteria.rule_group ? count(criteria.rule_group) : Object.values(criteria).filter((value) => value !== undefined && value !== '' && (!Array.isArray(value) || value.length > 0)).length;
}

/** Optional labels resolve product, owner, pipeline and signal IDs when the caller has their names. */
export function summarizeSmartSegmentCriteria(criteria: SmartListFilterCriteria, labels: Record<string, string> = {}): string {
  const displayValue = (value: unknown): string => {
    if (Array.isArray(value)) return value.map(displayValue).join(', ');
    if (value === true || value === 'true') return 'yes';
    if (value === false || value === 'false') return 'no';
    const text = String(value ?? '').trim();
    return labels[text] || (UUID.test(text) ? 'selected value' : text.replaceAll('_', ' '));
  };
  const ruleSummary = (rule: SegmentRule) => {
    const field = rule.field === 'custom_question' ? (rule.fieldKey || 'AI custom question') : rule.field === 'custom_field' ? (labels[rule.fieldKey || ''] || rule.fieldKey || 'Custom field') : FIELD_LABELS[rule.field];
    const operator = SEGMENT_OPERATORS[rule.field]?.find((option) => option.value === rule.operator)?.label || rule.operator;
    const context = ['icp_score', 'dm_score'].includes(rule.field) && rule.fieldKey ? ` for ${labels[rule.fieldKey] || 'selected product'}` : '';
    const value = ['exists', 'not_exists', 'is_empty'].includes(rule.operator) ? '' : displayValue(rule.value);
    if (rule.field === 'custom_question') return value ? `${field} answered with score ≥ ${value}` : `${field} has an answer`;
    return `${field}${context} ${operator}${value ? ` ${value}${['created_days_ago', 'activity_days_ago'].includes(rule.field) ? ' days' : ''}` : ''}`;
  };
  const summarizeGroup = (group: SegmentRuleGroup, nested = false): string => {
    const content = group.rules.map((node) => isSegmentRuleGroup(node) ? summarizeGroup(node, true) : ruleSummary(node)).join(group.operator === 'or' ? ' OR ' : ' AND ');
    return nested && group.rules.length > 1 ? `(${content})` : content;
  };
  if (criteria.rule_group) return summarizeGroup(criteria.rule_group) || 'No audience rules yet';
  const legacyLabels: Record<string, string> = { source: 'Contact source', status: 'Contact status', tags: 'Tags include', min_score: 'Lead score at least', max_score: 'Lead score at most', min_employee_count: 'Employee count at least', max_employee_count: 'Employee count at most', created_days_ago: 'Created within days', activity_days_ago: 'Active within days', has_email: 'Has email', has_linkedin: 'Has LinkedIn', icp_product_id: 'Product', min_icp_score: 'ICP score at least', max_icp_score: 'ICP score at most', min_dm_score: 'Decision-maker score at least', max_dm_score: 'Decision-maker score at most', signal_subscription_id: 'Discovered by', signal_max_age_days: 'Signal age within days', min_discovery_score: 'Discovery score at least' };
  return Object.entries(criteria).filter(([, value]) => value !== undefined && value !== '' && (!Array.isArray(value) || value.length)).map(([key, value]) => {
    if (key === 'custom_questions') return (value as NonNullable<SmartListFilterCriteria['custom_questions']>).map((question) => `${question.question} answered${question.minScore !== undefined ? ` with score ≥ ${question.minScore}` : ''}`).join(' AND ');
    if (key === 'custom_field_conditions') return (value as NonNullable<SmartListFilterCriteria['custom_field_conditions']>).map((condition) => `${labels[condition.fieldKey] || condition.fieldKey} ${condition.operator.replaceAll('_', ' ')}${condition.value ? ` ${condition.value}` : ''}`).join(' AND ');
    return `${legacyLabels[key] || key.replaceAll('_', ' ')} ${displayValue(value)}`;
  }).join(' AND ') || 'No audience rules yet';
}
