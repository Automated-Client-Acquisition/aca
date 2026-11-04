// ============================================================================
// ZapMail API Key Types
// ============================================================================

export interface ZapMailApiKey {
  id: string;
  organization_id: string;
  name: string;
  key_hint: string;
  is_valid: boolean;
  workspace_ids: string[];
  last_validated_at: string | null;
  last_sync_at: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Mailbox Types
// ============================================================================

export type MailboxStatus = "warming" | "ready" | "paused" | "burned" | "disconnected";

export type ConnectionType = "smtp" | "zapmail" | "google_oauth" | "outlook_oauth" | "postal" | "acs" | "m365";

export type InfraType = "postal" | "acs" | "m365" | "byo" | "postshiba";

export interface EmailMailbox {
  id: string;
  organization_id: string;
  zapmail_mailbox_id: string | null;
  zapmail_api_key_id: string | null;
  connection_type: ConnectionType;
  email_address: string;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  provider: "gmail" | "outlook" | "smtp" | null;
  status: MailboxStatus;
  daily_limit: number;
  daily_sent: number;
  daily_sent_reset_at: string;
  health_score: number;
  bounce_rate: number;
  reply_rate: number;
  spam_rate: number;
  last_send_at: string | null;
  last_error: string | null;
  imap_connected: boolean;
  owner_user_id: string | null;
  warmup_enabled: boolean;
  warmup_day: number | null;
  tags: string[];
  sending_domain_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface MailboxMetadataSettings {
  min_time_gap_minutes: number;
  reply_to_address: string | null;
  signature: string | null;
  bcc_crm_address: string | null;
  custom_tracking_enabled: boolean;
  custom_tracking_domain: string | null;
  custom_tracking_verified: boolean;
}

export interface EmailMailboxDailyStats {
  id: string;
  mailbox_id: string;
  stat_date: string;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  replied: number;
  bounced: number;
  spam_complaints: number;
}

// ============================================================================
// Sequence Types
// ============================================================================

export type SequenceStatus = "draft" | "active" | "paused" | "completed";

export type StepType = "email" | "delay" | "condition" | "ab_test";

export type ConditionType = "opened" | "clicked" | "replied" | "bounced";

export interface EmailSequenceStep {
  order: number;
  type: StepType;
  subject?: string;
  body?: string;
  /** Presence of 'html' means `body` is WYSIWYG-authored HTML; absent/anything else means legacy plain text. */
  body_format?: "html";
  delay_hours?: number;
  condition_type?: ConditionType;
  condition_timeout_hours?: number;
  variants?: ABVariantDraft[];
}

export interface ABVariantDraft {
  id?: string;
  variant_label: string;
  subject: string;
  body: string;
  /** Presence of 'html' means `body` is WYSIWYG-authored HTML; absent/anything else means legacy plain text. */
  body_format?: "html";
  split_percentage: number;
  is_winner?: boolean;
}

/**
 * Auto mailbox-pool rule. When `mode` is "auto" the frozen `mailbox_ids` list is
 * ignored and the pool is re-derived from tags + health on every send cycle, so
 * inboxes that recover (or that get added later) are picked up automatically.
 *
 * Pools are shared: an inbox can serve several active sequences, all drawing on
 * the same per-mailbox daily_limit. Offers are separated by tag, not ownership.
 */
export interface MailboxSelectionConfig {
  mode: "manual" | "auto";
  /**
   * Emails/day this sequence should place. Sizes the pool (enough healthy
   * inboxes to cover it) AND is mirrored into `settings.daily_limit`, which is
   * what the worker enforces. `null` = use the whole eligible fleet, uncapped.
   */
  daily_target: number | null;
  /** Restrict the pool to inboxes carrying these tags. Empty = whole fleet. */
  tags: string[];
  tag_match: "any" | "all";
}

/** Legacy sequences carry no rule — they stay on manual, i.e. today's behaviour. */
export const DEFAULT_MAILBOX_SELECTION: MailboxSelectionConfig = {
  mode: "manual",
  daily_target: null,
  tags: [],
  tag_match: "any",
};

export interface EmailSequenceSettings {
  // Mailbox Selection
  mailbox_ids: string[];
  /** Undefined on legacy sequences — treated as { mode: "manual" }. */
  mailbox_selection?: MailboxSelectionConfig;

  // Stop Conditions
  stop_on_reply: boolean;
  stop_on_auto_reply: boolean;
  stop_company_on_reply: boolean;

  // Tracking
  open_tracking: boolean;
  click_tracking: boolean;
  custom_tracking_domain: string | null; // deprecated — kept for backward compat
  tracking_domain_id: string | null;

  // Sending Pattern
  /**
   * Hard ceiling on sends/day for this sequence, enforced by the worker.
   * `null` means no sequence-level cap — volume is then bounded only by the
   * per-mailbox daily limits of the pool.
   *
   * In auto mode this is written from `mailbox_selection.daily_target`, so the
   * one number the user types both sizes the pool and caps the sending. Never
   * edit the two apart or "2,500/day" silently becomes 30/day again.
   */
  daily_limit: number | null;
  max_new_leads_per_day: number | null;
  min_time_gap_minutes: number;
  random_additional_minutes: number;
  prioritize_new_leads: boolean;
  send_window: { start: string; end: string };
  timezone: string;
  skip_weekends: boolean;

  // Provider Matching / ESP Routing
  provider_matching: boolean;
  esp_routing_rules: ESPRoutingRule[];

  // A/B Testing
  auto_optimize_ab: boolean;
  ab_winning_metric: "open_rate" | "click_rate" | "reply_rate";
  ab_sample_size: number;

  // AI Lead Filtering
  ai_filter_unlikely_reply: "skip" | "send";
  ai_filter_hostile: "skip" | "send";

  // Deliverability Optimization
  first_email_text_only: boolean;
  sisr_enabled: boolean;
  hypersend_mode: boolean;
  limit_per_company_domain: number | null;

  // Compliance
  unsubscribe_header: boolean;
  unsubscribe_link_footer: boolean;
  /**
   * Spintax template for the footer wording. `{a|b|c}` picks one at random per
   * send; `[text]` marks the hyperlinked part. Empty → built-in rotation.
   */
  unsubscribe_footer_text: string | null;
  allow_risky_emails: boolean;

  // CC/BCC
  cc: string[];
  bcc: string[];

  // CRM
  owner_id: string | null;
  tags: string[];

  // Variable Fallback Defaults
  variable_defaults: Record<string, string>;

  // Product (for {{product_*}} variable resolution at send time)
  product_id: string | null;
}

export interface ESPRoutingRule {
  recipient_domain: string;
  provider: string;
}

export type SequenceSourceType = 'manual' | 'template';

export interface AutopilotRule {
  intent: string;
  action: 'auto_reply' | 'send_calendly' | 'book_ghl_appointment' | 'auto_followup_after_return' | 'draft_for_approval' | 'escalate';
  calendly_link?: string;
  ghl_calendar_id?: string;
  message_template?: string;
  confidence_threshold?: number;
}

export interface EscalationRule {
  condition: 'low_confidence' | 'hostile_sentiment' | 'explicit_request' | 'max_turns' | 'custom_keyword';
  threshold?: number;
  keywords?: string[];
}

export interface AutopilotConfig {
  enabled: boolean;
  rules: AutopilotRule[];
  require_approval: boolean;
  max_auto_replies: number;
  conversation_goal?: string;
  system_instructions?: string;
  use_knowledge_base?: boolean;
  knowledge_document_ids?: string[];
  use_tone_profile?: boolean;
  max_conversation_turns?: number;
  owner_user_id?: string;
  escalation_rules?: EscalationRule[];
  booking_timezone?: string; // IANA timezone for GHL calendar booking (e.g. 'America/New_York')
  ghl_calendar_id?: string; // GHL calendar for automatic booking when scheduling is detected
}

export interface CampaignPowerSettings {
  stop_on_auto_reply: boolean;
  stop_company_on_reply: boolean;
  ai_filter_unlikely_reply: 'skip' | 'send';
  ai_filter_hostile: 'skip' | 'send';
}

export const DEFAULT_CAMPAIGN_POWER_SETTINGS: CampaignPowerSettings = {
  stop_on_auto_reply: false,
  stop_company_on_reply: false,
  ai_filter_unlikely_reply: 'send',
  ai_filter_hostile: 'send',
};

export interface CampaignRateSettings {
  min_delay_seconds?: number;
  max_delay_seconds?: number;
}

export const DEFAULT_CAMPAIGN_RATE_SETTINGS: CampaignRateSettings = {
  min_delay_seconds: 60,
  max_delay_seconds: 180,
};

export interface EmailSequence {
  id: string;
  organization_id: string;
  campaign_id: string | null;
  name: string;
  steps: EmailSequenceStep[];
  status: SequenceStatus;
  settings: EmailSequenceSettings;
  source_type: SequenceSourceType;
  autopilot_config?: AutopilotConfig;
  agent_profile_id?: string | null;
  /** Legacy single-list scalar; kept in sync = lead_list_ids[0]. */
  lead_list_id?: string | null;
  /** Lead lists this sequence pulls from (for continuous auto-enroll). */
  lead_list_ids?: string[];
  /** When true + at least one lead list set, the discovery-auto-enroll-sequences
   *  cron continuously enrolls newly-added list members every ~15 min. */
  auto_enroll_new_members?: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateEmailSequenceInput {
  name: string;
  campaign_id?: string;
  steps?: EmailSequenceStep[];
  settings?: Partial<EmailSequenceSettings>;
}

export interface UpdateEmailSequenceInput {
  id: string;
  /** Query scope for queued edits; never written as an editable sequence field. */
  organization_id?: string;
  name?: string;
  steps?: EmailSequenceStep[];
  status?: SequenceStatus;
  settings?: Partial<EmailSequenceSettings>;
  autopilot_config?: AutopilotConfig;
  agent_profile_id?: string | null;
  lead_list_id?: string | null;
  lead_list_ids?: string[];
  auto_enroll_new_members?: boolean;
  /** Filter step: only enrol list members matching these criteria. {} = everyone. */
  enroll_filter_criteria?: Record<string, unknown>;
}

// ============================================================================
// Enrollment Types
// ============================================================================

export type EnrollmentStatus =
  | "active"
  | "paused"
  | "completed"
  | "replied"
  | "bounced"
  | "unsubscribed"
  | "spam"
  | "sender_disconnected";

export interface EmailSequenceEnrollment {
  id: string;
  sequence_id: string;
  lead_id: string;
  current_step: number;
  status: EnrollmentStatus;
  next_send_at: string | null;
  mailbox_id: string | null;
  variant_assignments: Record<string, string>;
  condition_waiting_since: string | null;
  custom_data: Record<string, string>;
  cycle_number: number;
  created_at: string;
  updated_at: string;
  // Joined fields
  lead_name?: string;
  lead_email?: string;
  lead_position?: string;
  lead_company?: string;
  mailbox_email?: string;
  crm_contact_id?: string;
}

// ============================================================================
// Send Log Types
// ============================================================================

export type SendLogStatus =
  | "queued"
  | "sending"
  | "sent"
  | "delivered"
  | "auto_replied"
  | "opened"
  | "clicked"
  | "replied"
  | "bounced"
  | "blocked"
  | "spam"
  | "filtered";

export interface EmailSendLogEntry {
  id: string;
  organization_id: string;
  mailbox_id: string;
  campaign_id: string | null;
  lead_id: string | null;
  sequence_id: string | null;
  sequence_step: number | null;
  variant_id: string | null;
  recipient_email: string;
  subject: string | null;
  body: string | null;
  message_id: string | null;
  status: SendLogStatus;
  opened_at: string | null;
  clicked_at: string | null;
  replied_at: string | null;
  bounced_at: string | null;
  error_message: string | null;
  sent_at: string | null;
  created_at: string;
}

export interface SendLogFilters {
  mailbox_id?: string;
  campaign_id?: string;
  sequence_id?: string;
  status?: SendLogStatus;
  date_from?: string;
  date_to?: string;
  page?: number;
  page_size?: number;
}

// ============================================================================
// A/B Test Types
// ============================================================================

export interface EmailABVariant {
  id: string;
  sequence_id: string;
  step_index: number;
  variant_label: string;
  subject: string;
  body: string;
  split_percentage: number;
  sent: number;
  opened: number;
  clicked: number;
  replied: number;
  bounced: number;
  is_winner: boolean;
  created_at: string;
}

// ============================================================================
// Aggregated Stats Types
// ============================================================================

export interface EmailAggregatedStats {
  sent: number;
  unique_leads: number;
  delivered: number;
  opened: number;
  clicked: number;
  replied: number;
  bounced: number;
  /** Leads only ever refused for our sending domain's reputation: neither delivered nor bounced. */
  blocked?: number;
  open_rate: number;
  click_rate: number;
  reply_rate: number;
  bounce_rate: number;
  /** Unique leads whose reply the inbox classified interested / meeting booked. */
  positive?: number;
  /** Unique leads with a booked meeting (classified, or a GHL appointment). */
  meetings?: number;
  /** Leads whose only responses were out-of-office (segregated, never counted as replies). */
  out_of_office?: number;
  /** Leads whose only responses were other auto-replies (segregated, never counted as replies). */
  auto_replied?: number;
  /** Replies by classified intent; "unclassified" when the classifier hasn't labelled it. */
  intents?: Record<string, number>;
  /** AI-filtered (never sent) leads by reason. */
  filtered?: Record<string, number>;
  /** Funnel step: positive replies as a % of replies. */
  positive_rate?: number;
  /** Funnel step: meetings as a % of positive replies. */
  meeting_rate?: number;
  /** False for "All time", which has no prior period to compare against. */
  has_prev?: boolean;
  // Previous period for trends
  prev_sent?: number;
  prev_unique_leads?: number;
  prev_delivered?: number;
  prev_opened?: number;
  prev_clicked?: number;
  prev_replied?: number;
  prev_bounced?: number;
  prev_positive?: number;
  prev_meetings?: number;
}

/** One sequence's row in the campaign comparison table (unique-lead counts). */
export interface EmailSequencePerformance {
  sequence_id: string;
  sequence_name: string;
  sequence_status: string | null;
  sent: number;
  unique_leads: number;
  delivered: number;
  replied: number;
  positive: number;
  meetings: number;
  bounced: number;
  /** Leads only ever refused for our sending domain's reputation (kept out of `bounced`). */
  blocked: number;
  /** Leads that only sent out-of-office / auto-replies (kept out of `replied`). */
  auto_replies: number;
  last_sent_at: string | null;
  /** % of delivered leads that replied. */
  reply_rate: number;
  /** Funnel step: % of replies that were positive. */
  positive_rate: number;
  /** Funnel step: % of positive replies that booked a meeting. */
  meeting_rate: number;
  /** End-to-end yield: positive replies per delivered lead (reply rate x positive rate). */
  positive_per_lead: number;
  bounce_rate: number;
}

/** A lead behind the Replies / Positive / Meetings numbers. */
export interface EmailReplyLead {
  lead_key: string;
  recipient_email: string;
  contact_id: string | null;
  contact_name: string | null;
  conversation_id: string | null;
  sequence_id: string | null;
  sequence_name: string | null;
  lead_intent: string | null;
  meeting: boolean;
  replied_at: string;
  subject: string | null;
}

export interface EmailDailyTrend {
  date: string;
  sent: number;
  unique_leads: number;
  delivered: number;
  opened: number;
  clicked: number;
  replied: number;
  bounced: number;
}

// ============================================================================
// Per-Step Analytics
// ============================================================================

export interface StepStats {
  step: number;
  subject: string;
  sent: number;
  unique_leads: number;
  delivered: number;
  opened: number;
  clicked: number;
  replied: number;
  bounced: number;
  open_rate: number;
  click_rate: number;
  reply_rate: number;
}

// ============================================================================
// Cold Email Infrastructure Types
// ============================================================================

export type AzureTenantStatus = "pending" | "connected" | "error" | "disconnected";

export interface AzureTenant {
  id: string;
  organization_id: string;
  tenant_id: string;
  client_id: string;
  display_name: string | null;
  status: AzureTenantStatus;
  last_validated_at: string | null;
  last_error: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export type AzureSubscriptionStatus = "pending" | "connected" | "error" | "disconnected";

export interface AzureSubscription {
  id: string;
  organization_id: string;
  subscription_id: string;
  tenant_id: string;
  client_id: string;
  azure_tenant_id: string | null;
  resource_group: string;
  region: string;
  display_name: string | null;
  status: AzureSubscriptionStatus;
  last_validated_at: string | null;
  last_error: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export type PrerequisiteCheckStatus = 'ok' | 'pending' | 'error';

export interface PrerequisiteCheck {
  ok: boolean;
  status: PrerequisiteCheckStatus;
  message?: string;
  checked_at: string;
}

export type PrerequisiteKey =
  | 'consent'
  | 'license'
  | 'directory_roles'
  | 'security_defaults'
  | 'smtp_auth'
  | 'mail_send';

export type PrerequisitesStatus = Partial<Record<PrerequisiteKey, PrerequisiteCheck>>;

export interface M365Tenant {
  id: string;
  organization_id: string;
  tenant_id: string;
  onmicrosoft_domain: string;
  display_name: string | null;
  admin_email: string | null;
  consent_granted: boolean;
  consent_granted_at: string | null;
  exo_consent_granted: boolean;
  exo_consent_granted_at: string | null;
  status: 'pending' | 'consent_pending' | 'connected' | 'error' | 'disconnected';
  last_validated_at: string | null;
  last_error: string | null;
  metadata: Record<string, unknown>;
  prerequisites_status?: PrerequisitesStatus;
  pending_tenant_smtp_fix?: boolean;
  created_at: string;
  updated_at: string;
}

export type VMStatus = "pending" | "provisioning" | "running" | "stopped" | "error" | "deleting";
export type DnsStatus = "pending" | "records_generated" | "verified" | "dkim_pending" | "error";

export interface DnsRecord {
  type: "A" | "MX" | "TXT" | "CNAME";
  name: string;
  value: string;
  priority?: number;
  ttl: number;
  verified: boolean;
  description?: string;
  // Non-null when the record exists but the zone has additional records that
  // will silently break deliverability (duplicate SPF/DMARC, extra MX).
  conflict?: string | null;
}

export type DnsProviderType = "cloudflare";

export interface DnsProvider {
  id: string;
  organization_id: string;
  provider: DnsProviderType;
  account_id: string | null;
  account_name: string | null;
  validated_at: string | null;
  last_used_at: string | null;
  last_error: string | null;
  zone_count: number | null;
  token_permissions: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CloudflareZone {
  zone_id: string;
  name: string;
  status: "active" | "pending" | "initializing" | "moved" | "deleted" | "deactivated";
  name_servers: string[];
  account_id: string;
}

export interface EmailSendingDomain {
  id: string;
  organization_id: string;
  subscription_id: string;
  domain: string;
  vm_name: string | null;
  vm_status: VMStatus;
  public_ip: string | null;
  public_ip_resource_id: string | null;
  ip_assigned_at: string | null;
  dns_status: DnsStatus;
  dns_records: DnsRecord[];
  spf_verified: boolean;
  dkim_verified: boolean;
  dmarc_verified: boolean;
  /**
   * Inbound reachability. False means the domain has no MX record pointing at
   * its mail server, so replies and DMARC reports bounce at the sender even
   * though outbound mail sends fine.
   */
  mx_verified: boolean;
  dkim_selector: string;
  mailbox_count: number;
  max_mailboxes: number;
  forwarding_url: string | null;
  dmarc_email: string | null;
  forwarding_email: string | null;
  catchall_email: string | null;
  dns_provider_id: string | null;
  cloudflare_zone_id: string | null;
  nameservers_assigned: string[] | null;
  nameservers_active: string[] | null;
  dns_managed: boolean;
  catchall_enabled: boolean;
  domain_health: "healthy" | "warning" | "burned" | "resting" | "no_data";
  health_score: number;
  bounce_rate: number;
  spam_rate: number;
  burned_at: string | null;
  /** Observed reputation health; this does not decide whether sending is paused. */
  health_status?: "unknown" | "healthy" | "degrading" | "burned" | "recovering" | null;
  last_550_at?: string | null;
  last_550_reason?: string | null;
  consecutive_550?: number | null;
  last_probe_at?: string | null;
  last_probe_result?: string | null;
  /** Historical automatic hold deadline, retained as monitoring evidence. */
  rest_until?: string | null;
  clean_probe_streak?: number | null;
  next_probe_at?: string | null;
  sending_paused_at?: string | null;
  sending_paused_by?: string | null;
  sending_pause_reason?: string | null;
  reputation_blocked_at?: string | null;
  reputation_block_reason?: string | null;
  replaced_by_id: string | null;
  replaces_id: string | null;
  last_dns_check_at: string | null;
  last_health_check_at: string | null;
  infra_type: InfraType;
  acs_resource_group: string | null;
  acs_email_service_name: string | null;
  acs_email_service_resource_id: string | null;
  acs_comm_service_name: string | null;
  acs_comm_service_resource_id: string | null;
  acs_domain_resource_id: string | null;
  acs_domain_verification_status: "pending" | "verified" | "error" | null;
  acs_entra_app_id: string | null;
  acs_smtp_username: string | null;
  sender_addresses: Array<{ username: string; displayName: string; email: string }>;
  inbound_webhook_subscription_id: string | null;
  // M365-specific columns (infra_type='m365')
  m365_tenant_id?: string | null;
  m365_domain_id?: string | null;
  m365_domain_verified?: boolean;
  sync_avatars_to_m365?: boolean;
  // BYO-specific columns (infra_type='byo')
  byo_server_id?: string | null;
  byo_ip_pool?: string[];
  byo_postmaster_email?: string | null;
  byo_helo_hostname?: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// BYO (Bring-Your-Own) Email Infrastructure
// ============================================================================

export type ByoServerStatus =
  | "pending"
  | "connecting"
  | "deploying"
  | "ready"
  | "error"
  | "degraded"
  | "disconnected";

export type ByoIpStatus = "pending" | "active" | "cooling" | "blacklisted" | "disabled";

export type ByoProviderHint =
  | "hetzner"
  | "ovh"
  | "ionos"
  | "contabo"
  | "vultr"
  | "linode"
  | "digitalocean"
  | "aws"
  | "gcp"
  | "azure"
  | "other";

export interface ByoServer {
  id: string;
  organization_id: string;
  name: string;
  hostname: string;
  ssh_host: string;
  ssh_port: number;
  ssh_username: string;
  ssh_public_key: string | null;
  ssh_fingerprint: string | null;
  provider_hint: ByoProviderHint | null;
  port25_verified: boolean;
  port25_last_check_at: string | null;
  status: ByoServerStatus;
  last_error: string | null;
  postfix_version: string | null;
  opendkim_version: string | null;
  dovecot_version: string | null;
  deploy_state: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ByoBlocklistEntry {
  provider: string;
  listed_at: string;
  last_checked_at: string;
  code?: string;
}

export interface ByoServerIp {
  id: string;
  server_id: string;
  organization_id: string;
  ip_address: string;
  ptr_record: string | null;
  ptr_verified: boolean;
  status: ByoIpStatus;
  warmup_day: number;
  daily_send_limit: number;
  daily_sent: number;
  daily_sent_reset_at: string;
  blacklisted_on: ByoBlocklistEntry[];
  last_blacklist_check_at: string | null;
  health_score: number;
  domain_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export type InfraByoJobStatus = "pending" | "running" | "succeeded" | "failed" | "cancelled";

export type InfraByoJobType =
  | "connect"
  | "deploy_base"
  | "provision_domain"
  | "provision_mailbox"
  | "attach_ip"
  | "detach_ip"
  | "verify_dns"
  | "test_port25"
  | "rotate_ssh_key"
  | "install_tls"
  | "deprovision_mailbox"
  | "deprovision_domain"
  | "deprovision_server";

export type InfraByoJobTargetKind = "server" | "domain" | "mailbox" | "ip";

export interface InfraByoJob {
  id: string;
  organization_id: string;
  job_type: InfraByoJobType;
  status: InfraByoJobStatus;
  target_kind: InfraByoJobTargetKind;
  target_id: string | null;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  log: string | null;
  error_message: string | null;
  attempts: number;
  max_attempts: number;
  locked_until: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  created_by: string | null;
}

export interface CreateByoServerInput {
  name: string;
  hostname: string;
  ssh_host?: string;
  ssh_port?: number;
  ssh_username?: string;
  provider_hint?: ByoProviderHint;
}
