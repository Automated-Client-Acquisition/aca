/**
 * Role-account local-part prefixes.
 *
 * info@example.com / sales@example.com / postmaster@example.com etc. are
 * "role accounts" — distribution lists that broadcast to whoever's on duty,
 * not to a specific human. Cold email response rates on role accounts are
 * 5-10x lower than personal addresses, and at scale they trigger spam-trap
 * filters that watch for senders blasting role addresses.
 *
 * This is a flag, not a verdict: role addresses are verified like any other
 * mailbox and sent to when the provider says the mailbox is valid (local
 * businesses often only publish info@ / office@). The verifier records
 * is_role=true so lists can still filter them out.
 */

const ROLE_PREFIXES = new Set<string>([
  // Generic
  'info', 'contact', 'hello', 'hi', 'hey', 'mail', 'email', 'inbox', 'office',
  // Sales / marketing
  'sales', 'marketing', 'leads', 'partnerships', 'partner', 'partners',
  'business', 'biz', 'bizdev', 'newbusiness', 'new-business', 'press', 'media',
  'pr', 'communications', 'comms',
  // Support / customer service
  'support', 'help', 'helpdesk', 'service', 'customer', 'customerservice',
  'customer-service', 'customer_service', 'feedback', 'suggestions', 'tickets',
  // Admin / executive office
  'admin', 'administrator', 'office-admin', 'officeadmin', 'enquiries',
  'enquiry', 'inquiries', 'inquiry', 'reception',
  // HR / careers
  'hr', 'humanresources', 'human-resources', 'recruitment', 'recruiting',
  'careers', 'jobs', 'work',
  // Finance / accounting
  'accounts', 'accounting', 'accountspayable', 'accounts-payable',
  'accountsreceivable', 'accounts-receivable', 'finance', 'billing', 'invoice',
  'invoices', 'payments', 'payroll', 'tax',
  // Legal / compliance
  'legal', 'compliance', 'privacy', 'gdpr', 'dpo',
  // Technical / abuse / security (RFC 2142)
  'webmaster', 'postmaster', 'hostmaster', 'noc', 'security', 'abuse',
  'spam', 'phishing', 'noreply', 'no-reply', 'no_reply', 'donotreply',
  'do-not-reply', 'do_not_reply', 'mailer-daemon', 'daemon', 'bounce',
  'bounces', 'autoresponder', 'autoresponse', 'auto-reply',
  // Procurement / operations
  'procurement', 'orders', 'order', 'purchase', 'purchasing', 'shipping',
  'returns', 'logistics', 'operations', 'ops',
  // Distribution lists
  'team', 'staff', 'all', 'everyone', 'group', 'department', 'dept',
  'committee', 'board',
  // Owner / general (less obvious — leave out by default; enable via override)
  // 'owner', 'founder', 'ceo', 'cto', 'cfo', 'coo', 'president', 'director',
]);

/**
 * Returns true if the local part of an email matches a known role prefix.
 *
 * Matching is exact case-insensitive on the local part (everything before @).
 * Hyphenated and underscored variants like `accounts-payable` and
 * `accounts_payable` are listed separately.
 */
export function isRoleLocalPart(localPart: string | null | undefined): boolean {
  if (!localPart) return false;
  const normalized = localPart.trim().toLowerCase();
  if (!normalized) return false;
  return ROLE_PREFIXES.has(normalized);
}

/**
 * Returns true if the email's local part is a role account.
 */
export function isRoleEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const at = email.lastIndexOf('@');
  if (at === -1) return false;
  return isRoleLocalPart(email.slice(0, at));
}

export function rolePrefixCount(): number {
  return ROLE_PREFIXES.size;
}
