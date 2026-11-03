export type StrategyDocumentType =
  | 'lead_magnet'
  | 'sales_strategy'
  | 'content_calendar'
  | 'funnel'
  | 'email_sequence'
  | 'landing_page'
  | 'ad_copy'
  | 'other';

export interface StrategyDocument {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  document_type: StrategyDocumentType;
  content: string | null;
  file_url: string | null;
  file_name: string | null;
  file_type: string | null;
  tags: string[] | null;
  related_product_ids: string[] | null;
  related_icp_ids: string[] | null;
  version: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export const STRATEGY_DOCUMENT_TYPES: { value: StrategyDocumentType; label: string; icon: string }[] = [
  { value: 'lead_magnet', label: 'Lead Magnet', icon: '🧲' },
  { value: 'sales_strategy', label: 'Sales Strategy', icon: '📈' },
  { value: 'content_calendar', label: 'Content Calendar', icon: '📅' },
  { value: 'funnel', label: 'Funnel', icon: '🔻' },
  { value: 'email_sequence', label: 'Email Sequence', icon: '📧' },
  { value: 'landing_page', label: 'Landing Page', icon: '🌐' },
  { value: 'ad_copy', label: 'Ad Copy', icon: '📢' },
  { value: 'other', label: 'Other', icon: '📄' },
];

export function getDocumentTypeLabel(type: StrategyDocumentType): string {
  // Playbooks write types outside this list (content_plan, knowledge, strategy); show them as words.
  return (
    STRATEGY_DOCUMENT_TYPES.find(t => t.value === type)?.label ||
    String(type ?? "other").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())
  );
}

export function getDocumentTypeIcon(type: StrategyDocumentType): string {
  return STRATEGY_DOCUMENT_TYPES.find(t => t.value === type)?.icon || '📄';
}
