/**
 * Microsoft 365 / MS Graph API Client
 *
 * Provides all MS Graph operations needed for M365 tenant-based email infrastructure:
 * - Tenant authentication via client credentials + admin consent
 * - Domain management (add, verify, delete)
 * - User/mailbox management (create, delete, SMTP AUTH enablement)
 * - DNS record transformation
 *
 * Authentication model:
 *   Single Azure AD app registration (multi-tenant) — "ACA Email Infra":
 *   M365_APP_CLIENT_ID / M365_APP_CLIENT_SECRET
 *   - Has both Microsoft Graph + Exchange Online permissions
 *   - /adminconsent grants all permissions in one step
 *   - AADSTS650052 means the tenant lacks an Exchange Online license
 *     (Business Basic or higher required)
 */

const GRAPH_URL = 'https://graph.microsoft.com/v1.0';
const GRAPH_BETA_URL = 'https://graph.microsoft.com/beta';
const LOGIN_URL = 'https://login.microsoftonline.com';

// ============================================================================
// Error Class
// ============================================================================

export class M365Error extends Error {
  constructor(
    public code: string,
    message: string,
    public status?: number
  ) {
    super(message);
    this.name = 'M365Error';
  }
}

// ============================================================================
// Types
// ============================================================================

export interface M365DnsRecord {
  recordType: 'Mx' | 'Txt' | 'CName';
  label: string;
  ttl: number;
  isOptional: boolean;
  supportedService: string;
  // TXT value — Graph returns it as a direct top-level "text" string
  text?: string | { text: string };
  additionalProperties?: { text?: string; [key: string]: unknown };
  // MX fields — Graph returns these as flat top-level properties (NOT nested in mxRecord)
  mailExchange?: string;
  preference?: number;
  mxRecord?: { mailExchange: string; preference: number }; // legacy fallback
  // CNAME fields — Graph returns these as flat top-level properties (NOT nested in cnameRecord)
  canonicalName?: string;
  cnameRecord?: { canonicalName: string }; // legacy fallback
}

export interface M365TenantDomain {
  id: string;
  isVerified: boolean;
  isDefault: boolean;
  authenticationType: string;
}

export interface CreateUserParams {
  displayName: string;
  mailNickname: string;      // username portion before @
  userPrincipalName: string; // full email e.g. john@mail.acmecorp.com
  password: string;
  usageLocation?: string;    // default 'US'
}

// Reuse existing DnsRecord type from the codebase
export interface DnsRecord {
  type: 'A' | 'MX' | 'TXT' | 'CNAME';
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

// ============================================================================
// Authentication
// ============================================================================

/**
 * Get "full" app credentials — has both Graph + Exchange Online permissions.
 * Used for EXO consent and EXO token acquisition.
 * App ID: M365_APP_CLIENT_ID / M365_APP_CLIENT_SECRET
 */
function getAppCredentials(): { clientId: string; clientSecret: string } {
  const clientId = Deno.env.get('M365_APP_CLIENT_ID');
  const clientSecret = Deno.env.get('M365_APP_CLIENT_SECRET');
  if (!clientId || !clientSecret) {
    throw new M365Error('CONFIG_ERROR', 'M365_APP_CLIENT_ID and M365_APP_CLIENT_SECRET must be set');
  }
  return { clientId, clientSecret };
}

/**
 * Get Graph-only app credentials.
 * @deprecated Now returns the same as getAppCredentials() — single app for everything.
 * Kept for backward compatibility.
 */
function getGraphAppCredentials(): { clientId: string; clientSecret: string } {
  return getAppCredentials();
}



/**
 * Get an access token using client credentials flow.
 * Targets the customer's tenant using the specified app credentials.
 */
async function getTokenWithCredentials(
  tenantId: string,
  scope: string,
  credentials: { clientId: string; clientSecret: string }
): Promise<string> {
  const res = await fetch(`${LOGIN_URL}/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      scope,
    }),
  });

  if (!res.ok) {
    const error = await res.text();
    if (error.includes('AADSTS700016') || error.includes('AADSTS65001') || error.includes('AADSTS7000229')) {
      throw new M365Error('CONSENT_NOT_GRANTED', 'Admin consent has not been granted for this tenant. Please complete the consent flow.', 403);
    }
    throw new M365Error('AUTH_FAILED', `Failed to get M365 token: ${error}`, res.status);
  }

  const data = await res.json();
  return data.access_token as string;
}

/** Get an MS Graph token using the full app credentials. */
export async function getM365Token(tenantId: string): Promise<string> {
  return getTokenWithCredentials(tenantId, 'https://graph.microsoft.com/.default', getAppCredentials());
}

/**
 * Get an MS Graph token using the full app.
 * @deprecated Now identical to getM365Token() — single app for everything. Kept for backward compat.
 */
export async function getFullAppGraphToken(tenantId: string): Promise<string> {
  return getTokenWithCredentials(tenantId, 'https://graph.microsoft.com/.default', getAppCredentials());
}

/** Get an Exchange Online token. */
export async function getEXOToken(tenantId: string): Promise<string> {
  return getTokenWithCredentials(tenantId, 'https://outlook.office.com/.default', getAppCredentials());
}

// ============================================================================
// Email Sending (Microsoft Graph)
// ============================================================================

export interface GraphSendParams {
  tenantId: string;
  /** Graph user GUID or UPN/email of the sending mailbox. */
  senderUserId: string;
  toEmail: string;
  subject: string;
  html?: string;
  text?: string;
  cc?: string[];
  bcc?: string[];
  /** RFC In-Reply-To header value for threading (without angle brackets stripped). */
  inReplyTo?: string;
  /** RFC References header values for threading. */
  references?: string[];
  /** Keep a copy in the mailbox's Sent Items (default true). */
  saveToSentItems?: boolean;
  /**
   * Custom internet message headers. Graph only permits `x-*` names here — any
   * other key is dropped rather than rejected. Used by the warmup engine to carry
   * `x-aca-warmup-id`, since sendMail returns 202 with no Message-Id to correlate on.
   */
  headers?: Record<string, string>;
  /**
   * Inline base64 attachments. Graph's sendMail has no separate upload step
   * for this payload shape, so large files count against the ~4MB total
   * message size limit — fine for typical reply attachments, not for bulk media.
   */
  attachments?: Array<{ filename: string; mimeType: string; contentBytes: string }>;
}

export interface GraphSendResult {
  success: boolean;
  error?: string;
  code?: string;
}

/**
 * Send an email via Microsoft Graph (POST /users/{id}/sendMail) using the
 * multi-tenant "ACA Email Infra" app's application Mail.Send permission.
 *
 * This is the same transport ACA's managed M365 mailboxes use for campaign
 * sends. Unlike Basic SMTP AUTH it needs no per-mailbox password, so it is
 * immune to stored-credential drift / decryption failures and to Microsoft's
 * Basic-auth blocks (5.7.139 etc.). Requires the tenant to have consented the
 * Graph Mail.Send app role (see checkSendAppMailSendConsent); tenants missing
 * that consent return 403 ErrorAccessDenied and callers should fall back to SMTP.
 *
 * sendMail returns 202 Accepted with no body, so there is no synchronous
 * Internet Message-Id to capture (same as the campaign worker).
 */
export async function sendEmailViaGraph(params: GraphSendParams): Promise<GraphSendResult> {
  let token: string;
  try {
    token = await getM365Token(params.tenantId);
  } catch (e) {
    const err = e as M365Error;
    return { success: false, error: err.message, code: err.code || 'AUTH_FAILED' };
  }

  const toRecipient = (address: string) => ({ emailAddress: { address } });
  const message: Record<string, unknown> = {
    subject: params.subject,
    body: {
      contentType: params.html ? 'HTML' : 'Text',
      content: params.html ?? params.text ?? '',
    },
    toRecipients: [toRecipient(params.toEmail)],
  };
  if (params.cc?.length) message.ccRecipients = params.cc.map(toRecipient);
  if (params.bcc?.length) message.bccRecipients = params.bcc.map(toRecipient);

  // Thread the reply by setting the RFC In-Reply-To / References headers.
  // Graph's internetMessageHeaders only permits custom (x-*) headers, so the
  // standard threading headers must be written via MAPI extended properties:
  //   PidTagInReplyToId        → "String 0x1042"
  //   PidTagInternetReferences → "String 0x1039"
  const extendedProps: Array<{ id: string; value: string }> = [];
  if (params.inReplyTo) {
    extendedProps.push({ id: 'String 0x1042', value: params.inReplyTo });
  }
  if (params.references?.length) {
    extendedProps.push({ id: 'String 0x1039', value: params.references.join(' ') });
  }
  if (extendedProps.length) message.singleValueExtendedProperties = extendedProps;

  if (params.attachments?.length) {
    message.attachments = params.attachments.map((att) => ({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: att.filename,
      contentType: att.mimeType,
      contentBytes: att.contentBytes,
    }));
  }

  // Graph rejects non-`x-` prefixed custom headers, so filter rather than let the
  // whole sendMail call fail on a caller's typo.
  if (params.headers) {
    const custom = Object.entries(params.headers)
      .filter(([name]) => /^x-/i.test(name))
      .map(([name, value]) => ({ name, value }));
    if (custom.length) message.internetMessageHeaders = custom;
  }

  const res = await fetch(`${GRAPH_URL}/users/${encodeURIComponent(params.senderUserId)}/sendMail`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, saveToSentItems: params.saveToSentItems ?? true }),
  });

  // sendMail returns 202 Accepted (empty body) on success.
  if (res.ok) return { success: true };

  const errorText = await res.text();
  let code = 'GRAPH_ERROR';
  let errMessage = errorText;
  try {
    const json = JSON.parse(errorText);
    code = json.error?.code || code;
    errMessage = json.error?.message || errMessage;
  } catch { /* not JSON */ }
  return { success: false, error: errMessage, code };
}


/**
 * Resolve the Azure AD tenant GUID from an onmicrosoft.com domain.
 * Uses the OpenID Connect discovery endpoint — no authentication needed.
 */
export async function resolveTenantId(onmicrosoftDomain: string): Promise<string> {
  // Normalize: strip protocol if provided
  const domain = onmicrosoftDomain.replace(/^https?:\/\//, '').trim().toLowerCase();

  const res = await fetch(
    `${LOGIN_URL}/${domain}/.well-known/openid-configuration`
  );

  if (!res.ok) {
    throw new M365Error('TENANT_NOT_FOUND', `Could not resolve tenant for domain: ${domain}. Make sure the onmicrosoft.com domain is correct.`, 404);
  }

  const data = await res.json();
  // token_endpoint format: https://login.microsoftonline.com/{tenant-guid}/oauth2/v2.0/token
  const tokenEndpoint = data.token_endpoint as string;
  const match = tokenEndpoint.match(/login\.microsoftonline\.com\/([^/]+)\//);
  if (!match) {
    throw new M365Error('TENANT_PARSE_FAILED', 'Could not parse tenant ID from OpenID configuration');
  }

  return match[1];
}

/**
 * Build the admin consent URL for the single "ACA Email Infra" app.
 * One consent grants both Graph + Exchange Online permissions.
 * If AADSTS650052 occurs, the tenant needs a Business Basic license (or higher).
 */
export function buildAdminConsentUrl(tenantId: string, stateRowId: string, loginHint?: string, domainHint?: string): string {
  const { clientId } = getAppCredentials();
  const redirectUri = Deno.env.get('M365_CONSENT_REDIRECT_URI');

  if (!redirectUri) {
    throw new M365Error('CONFIG_ERROR', 'M365_CONSENT_REDIRECT_URI must be set');
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    state: stateRowId,
    prompt: 'consent',
    ...(loginHint ? { login_hint: loginHint } : {}),
    ...(domainHint ? { domain_hint: domainHint } : {}),
  });

  return `${LOGIN_URL}/${tenantId}/adminconsent?${params.toString()}`;
}

/**
 * Build the admin consent URL for Exchange Online permissions.
 * @deprecated Now identical to buildAdminConsentUrl() — single app for everything. Kept for backward compat.
 */
export function buildExoConsentUrl(tenantId: string, stateRowId: string, loginHint?: string, domainHint?: string): string {
  return buildAdminConsentUrl(tenantId, stateRowId, loginHint, domainHint);
}

// Microsoft Graph application role id for **Mail.Send**. Managed M365 mailboxes
// send via Graph POST /users/{id}/sendMail; without this role on the send app's
// service principal, every send returns 403 ErrorAccessDenied even though the
// mailbox provisions and SMTP-auths fine.
export const GRAPH_MAIL_SEND_ROLE_ID = 'b633e1c5-b582-4048-a93e-9f11b44c7e96';

/**
 * Microsoft Graph application role id for **Mail.ReadWrite**.
 *
 * Needed by the warmup engine's receive tick, which must read the recipient
 * mailbox to determine inbox-vs-junk placement and then MOVE the message out of
 * Junk. Mail.Send alone is not sufficient. Tenants without this consented fall
 * back to the IMAP path (every mailbox has imap_host/imap_port stored), so spam
 * rescue degrades rather than breaks.
 */
export const GRAPH_MAIL_READWRITE_ROLE_ID = 'e2a3a72e-5f79-4c64-b1b1-878b674786c9';

/**
 * Check whether the Graph **send app** (default M365_APP_CLIENT_ID, "ACA email
 * Infra") has the Graph Mail.Send application role consented on a tenant.
 *
 * Mail.Send was added to the app registration after some tenants were already
 * admin-consented; those tenants hold a *stale* consent that grants every other
 * Graph/EXO role but not Mail.Send, so their mailboxes silently fail to send.
 * The consent *date* is not a reliable proxy (re-consent was applied per-tenant,
 * not strictly by date) — this live appRoleAssignments read is the only truth.
 * See memory note project_m365_mailsend_stale_consent_audit.
 *
 * `graphToken` must be a Microsoft Graph token for this tenant (the same token
 * minted by getM365Token()). Returns:
 *   { consented: true }                    — Mail.Send is granted → Graph send works
 *   { consented: false }                   — send app present but Mail.Send absent
 *   { consented: false, appMissing: true } — send app not provisioned on the tenant
 *   { consented: null, error }             — could not determine (read failed); callers
 *                                            should fail-open rather than block on this
 */
export async function checkSendAppMailSendConsent(
  graphToken: string,
  sendAppId?: string,
): Promise<{ consented: boolean | null; appMissing?: boolean; error?: string }> {
  return checkSendAppRole(graphToken, GRAPH_MAIL_SEND_ROLE_ID, sendAppId);
}

/**
 * Headlessly grant the Graph **Mail.Send** app role to the send app's service
 * principal on a tenant (the admin-consent-equivalent that lets the worker
 * Graph-send), by POSTing appRoleAssignedTo on the tenant's Microsoft Graph SP.
 *
 * Prerequisite: the calling app (b22ff92d) must itself hold
 * **AppRoleAssignment.ReadWrite.All** consented ON THIS TENANT — otherwise Graph
 * returns 403 and this returns { granted:false } harmlessly. That permission is
 * only present once a Global Admin has consented to it, so this CANNOT bootstrap
 * itself onto a stale tenant; it self-heals future tenants / drift where the
 * permission is already in place. `graphToken` must be a Graph token for the
 * tenant (from getM365Token()). See project_m365_mailsend_stale_consent_audit.
 */
export async function grantSendAppMailSend(
  graphToken: string,
  sendAppId?: string,
): Promise<{ granted: boolean; alreadyExisted?: boolean; status?: number; error?: string }> {
  return grantSendAppRole(graphToken, GRAPH_MAIL_SEND_ROLE_ID, sendAppId);
}

/**
 * Check whether an arbitrary Graph app role is consented on a tenant.
 * Generalisation of checkSendAppMailSendConsent — see that function for the
 * fail-open semantics of a `null` result.
 */
export async function checkSendAppRole(
  graphToken: string,
  appRoleId: string,
  sendAppId?: string,
): Promise<{ consented: boolean | null; appMissing?: boolean; error?: string }> {
  const appId = sendAppId || Deno.env.get('M365_APP_CLIENT_ID') || '';
  if (!appId) return { consented: null, error: 'M365_APP_CLIENT_ID not set' };
  try {
    const spRes = await fetch(
      `${GRAPH_URL}/servicePrincipals?$filter=${encodeURIComponent(`appId eq '${appId}'`)}&$select=id,appId`,
      { headers: { Authorization: `Bearer ${graphToken}` } },
    );
    if (!spRes.ok) return { consented: null, error: `servicePrincipals read failed (${spRes.status})` };
    const sp = ((await spRes.json())?.value || [])[0] as { id?: string } | undefined;
    if (!sp?.id) return { consented: false, appMissing: true };

    const raRes = await fetch(
      `${GRAPH_URL}/servicePrincipals/${sp.id}/appRoleAssignments?$select=appRoleId`,
      { headers: { Authorization: `Bearer ${graphToken}` } },
    );
    if (!raRes.ok) return { consented: null, error: `appRoleAssignments read failed (${raRes.status})` };
    const roles = ((await raRes.json())?.value || []) as Array<{ appRoleId?: string }>;
    return { consented: roles.some((a) => a.appRoleId === appRoleId) };
  } catch (e) {
    return { consented: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Headlessly grant an arbitrary Graph application role to the send app's service
 * principal on a tenant. Same prerequisite and failure semantics as documented on
 * grantSendAppMailSend: needs AppRoleAssignment.ReadWrite.All already consented on
 * the tenant, so it self-heals drift but cannot bootstrap a stale tenant.
 */
export async function grantSendAppRole(
  graphToken: string,
  appRoleId: string,
  sendAppId?: string,
): Promise<{ granted: boolean; alreadyExisted?: boolean; status?: number; error?: string }> {
  const appId = sendAppId || Deno.env.get('M365_APP_CLIENT_ID') || '';
  if (!appId) return { granted: false, error: 'M365_APP_CLIENT_ID not set' };
  const GRAPH_RESOURCE_APPID = '00000003-0000-0000-c000-000000000000';
  const spLookup = async (filter: string) => {
    const r = await fetch(
      `https://graph.microsoft.com/v1.0/servicePrincipals?$filter=${encodeURIComponent(filter)}&$select=id,appId`,
      { headers: { Authorization: `Bearer ${graphToken}` } },
    );
    if (!r.ok) throw new Error(`servicePrincipals read failed (${r.status})`);
    return ((await r.json())?.value || [])[0] as { id: string; appId: string } | undefined;
  };
  try {
    const senderSp = await spLookup(`appId eq '${appId}'`);
    const graphSp = await spLookup(`appId eq '${GRAPH_RESOURCE_APPID}'`);
    if (!senderSp) return { granted: false, error: 'send app service principal not found on tenant' };
    if (!graphSp) return { granted: false, error: 'Microsoft Graph service principal not found on tenant' };

    const res = await fetch(
      `https://graph.microsoft.com/v1.0/servicePrincipals/${graphSp.id}/appRoleAssignedTo`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${graphToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ principalId: senderSp.id, resourceId: graphSp.id, appRoleId }),
      },
    );
    if (res.ok) return { granted: true, status: res.status };
    const body = await res.text();
    const already = /already exists|being assigned already exists/i.test(body);
    return { granted: already, alreadyExisted: already, status: res.status, error: already ? undefined : body };
  } catch (e) {
    return { granted: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ============================================================================
// Mailbox read / message placement (warmup receive side)
// ============================================================================

export interface FoundMessage {
  id: string;
  folder: 'inbox' | 'junk';
  subject: string;
  receivedDateTime: string;
  internetMessageId?: string;
}

/**
 * Locate a warmup message inside a recipient mailbox and report where it landed.
 *
 * Inbox-vs-Junk placement is the only honest measure of whether warmup is working
 * — a "sent" counter says nothing about reputation. This searches the Inbox and
 * JunkEmail well-known folders for a message from `fromAddress` with an exact
 * subject match received at or after `since`.
 *
 * Matching cannot use Message-Id: Graph sendMail returns 202 Accepted with no
 * synchronous Internet Message-Id. Sender + exact subject + a bounded receive
 * window is unambiguous in practice given the subject pool size and pair cooldown.
 *
 * Requires the Mail.ReadWrite (or at minimum Mail.Read) app role on the tenant.
 */
export async function findWarmupMessage(
  tenantId: string,
  userId: string,
  opts: { fromAddress: string; subject: string; since: string },
): Promise<{ found: FoundMessage | null; error?: string }> {
  let token: string;
  try {
    token = await getM365Token(tenantId);
  } catch (e) {
    return { found: null, error: (e as M365Error).message };
  }

  const folders: Array<{ well: string; label: 'inbox' | 'junk' }> = [
    { well: 'inbox', label: 'inbox' },
    { well: 'junkemail', label: 'junk' },
  ];

  for (const folder of folders) {
    // $filter on from/receivedDateTime is server-side; subject is compared here
    // because Graph's string equality on subject is case- and whitespace-fragile.
    const filter =
      `receivedDateTime ge ${opts.since} and ` +
      `from/emailAddress/address eq '${opts.fromAddress.replace(/'/g, "''")}'`;
    const url =
      `${GRAPH_URL}/users/${encodeURIComponent(userId)}/mailFolders/${folder.well}/messages` +
      `?$filter=${encodeURIComponent(filter)}` +
      `&$select=id,subject,receivedDateTime,internetMessageId&$top=25&$orderby=receivedDateTime desc`;

    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      // 403 here means Mail.Read/ReadWrite is not consented on this tenant.
      const body = await res.text();
      return { found: null, error: `graph read ${folder.well} failed (${res.status}): ${body.slice(0, 200)}` };
    }

    const messages = ((await res.json())?.value || []) as Array<{
      id: string; subject?: string; receivedDateTime: string; internetMessageId?: string;
    }>;

    const wanted = opts.subject.trim().toLowerCase();
    const hit = messages.find((m) => (m.subject || '').trim().toLowerCase() === wanted);
    if (hit) {
      return {
        found: {
          id: hit.id,
          folder: folder.label,
          subject: hit.subject || '',
          receivedDateTime: hit.receivedDateTime,
          internetMessageId: hit.internetMessageId,
        },
      };
    }
  }

  return { found: null };
}

/**
 * Move a message into the Inbox — the "not spam" action.
 *
 * This is the single highest-value warmup operation. Rescuing mail out of Junk
 * and into the Inbox is what teaches the receiving provider that traffic from the
 * sending domain is wanted; sending alone does not rebuild reputation.
 *
 * Requires Mail.ReadWrite. Returns granted=false rather than throwing so the
 * caller can fall back to IMAP or simply record placement without the rescue.
 */
export async function moveMessageToInbox(
  tenantId: string,
  userId: string,
  messageId: string,
): Promise<{ moved: boolean; error?: string }> {
  let token: string;
  try {
    token = await getM365Token(tenantId);
  } catch (e) {
    return { moved: false, error: (e as M365Error).message };
  }

  const res = await fetch(
    `${GRAPH_URL}/users/${encodeURIComponent(userId)}/messages/${messageId}/move`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ destinationId: 'inbox' }),
    },
  );

  if (res.ok) return { moved: true };
  const body = await res.text();
  return { moved: false, error: `graph move failed (${res.status}): ${body.slice(0, 200)}` };
}

/**
 * Mark a message read. Warmup mail that is delivered and never opened is a weak
 * engagement signal; reading it before replying more closely resembles a real
 * correspondent and is what providers actually measure.
 */
export async function markMessageRead(
  tenantId: string,
  userId: string,
  messageId: string,
): Promise<{ ok: boolean; error?: string }> {
  let token: string;
  try {
    token = await getM365Token(tenantId);
  } catch (e) {
    return { ok: false, error: (e as M365Error).message };
  }

  const res = await fetch(
    `${GRAPH_URL}/users/${encodeURIComponent(userId)}/messages/${messageId}`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ isRead: true }),
    },
  );
  return res.ok ? { ok: true } : { ok: false, error: `graph patch failed (${res.status})` };
}

/**
 * List messages with attachments in a mailbox folder, unread first-to-last.
 * Used by the DMARC rua collector poller — reports arrive as attachments,
 * one per receiver per day, and we only care about ones not yet processed.
 */
export async function listUnreadMessagesWithAttachments(
  tenantId: string,
  userId: string,
  opts: { folder?: string; top?: number } = {},
): Promise<Array<{ id: string; subject: string; receivedDateTime: string }>> {
  let token: string;
  try {
    token = await getM365Token(tenantId);
  } catch (e) {
    throw new M365Error('AUTH_FAILED', (e as M365Error).message);
  }

  const folder = opts.folder ?? 'inbox';
  // Graph rejects $orderby unless the ordered property is ALSO the first clause
  // of $filter (400 InefficientFilter). The receivedDateTime clause matches
  // every message; it exists only to satisfy that rule.
  const url =
    `${GRAPH_URL}/users/${encodeURIComponent(userId)}/mailFolders/${folder}/messages` +
    `?$filter=${encodeURIComponent('receivedDateTime ge 1900-01-01T00:00:00Z and hasAttachments eq true and isRead eq false')}` +
    `&$select=id,subject,receivedDateTime&$top=${opts.top ?? 50}&$orderby=receivedDateTime asc`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const body = await res.text();
    throw new M365Error('GRAPH_ERROR', `list messages failed (${res.status}): ${body.slice(0, 200)}`, res.status);
  }
  const data = await res.json();
  return (data.value || []) as Array<{ id: string; subject: string; receivedDateTime: string }>;
}

/** List an email's attachments (metadata only — no content). */
export async function listMessageAttachments(
  tenantId: string,
  userId: string,
  messageId: string,
): Promise<Array<{ id: string; name: string; contentType: string; size: number }>> {
  let token: string;
  try {
    token = await getM365Token(tenantId);
  } catch (e) {
    throw new M365Error('AUTH_FAILED', (e as M365Error).message);
  }

  const res = await fetch(
    `${GRAPH_URL}/users/${encodeURIComponent(userId)}/messages/${messageId}/attachments?$select=id,name,contentType,size`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new M365Error('GRAPH_ERROR', `list attachments failed (${res.status}): ${body.slice(0, 200)}`, res.status);
  }
  const data = await res.json();
  return (data.value || []) as Array<{ id: string; name: string; contentType: string; size: number }>;
}

/** Download a file attachment's raw bytes (decoded from Graph's base64 contentBytes). */
export async function downloadAttachmentBytes(
  tenantId: string,
  userId: string,
  messageId: string,
  attachmentId: string,
): Promise<Uint8Array> {
  let token: string;
  try {
    token = await getM365Token(tenantId);
  } catch (e) {
    throw new M365Error('AUTH_FAILED', (e as M365Error).message);
  }

  const res = await fetch(
    `${GRAPH_URL}/users/${encodeURIComponent(userId)}/messages/${messageId}/attachments/${attachmentId}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new M365Error('GRAPH_ERROR', `download attachment failed (${res.status}): ${body.slice(0, 200)}`, res.status);
  }
  const data = await res.json();
  const b64 = data.contentBytes as string | undefined;
  if (!b64) {
    throw new M365Error('NOT_FILE_ATTACHMENT', `attachment ${attachmentId} has no contentBytes (item/reference attachment, not a file)`);
  }
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

// ============================================================================
// Service Principal Management
// ============================================================================

const EXO_SERVICE_APP_ID = '00000002-0000-0ff1-ce00-000000000000'; // Office 365 Exchange Online

// Built-in directory role template ID for "Exchange Recipient Administrator"
// Required for our app SP to manage shared mailboxes via EXO REST.
const EXCHANGE_RECIPIENT_ADMIN_ROLE_ID = '31392ffb-586c-42d1-9346-e59415a2cc4e';

// Built-in directory role template ID for "User Administrator".
// Required to reset passwords on app-created users via PATCH /users/{id}.
// Graph API permissions (User.ReadWrite.All, UserAuthenticationMethod.ReadWrite.All)
// are NOT sufficient on their own — a directory role is also required.
const USER_ADMIN_ROLE_ID = 'fe930be7-5e62-47db-91af-98c3a49a38b1';

// Built-in directory role template ID for "Exchange Administrator".
// Required to invoke tenant-wide cmdlets like Set-TransportConfig via the EXO
// Admin REST API. Exchange Recipient Administrator alone is NOT sufficient for
// tenant-level configuration changes.
const EXCHANGE_ADMIN_ROLE_ID = '29232cdf-9323-42fd-ade2-1d097af3e4de';

/**
 * Internal: assign a built-in directory role to our app's service principal
 * in the customer tenant. Idempotent.
 *
 * Requires Graph permission: RoleManagement.ReadWrite.Directory (Application, admin-consented).
 */
async function ensureDirectoryRoleForSelf(
  token: string,
  roleDefinitionId: string,
  roleLabel: string
): Promise<{ assigned: boolean; alreadyAssigned: boolean; servicePrincipalId: string }> {
  const { clientId } = getAppCredentials();

  // 1. Find our app's SP in the customer tenant
  const spFilterUrl = `${GRAPH_URL}/servicePrincipals?$filter=appId eq '${clientId}'&$select=id,appId,displayName`;
  const spData = await graphFetch(token, spFilterUrl);
  const sp = spData.value?.[0];
  if (!sp) {
    throw new M365Error(
      'SP_NOT_FOUND',
      `Service principal for app ${clientId} not found in tenant. Admin consent must be granted first.`
    );
  }
  const servicePrincipalId = sp.id as string;

  // 2. Check if the role is already assigned to this SP
  const checkUrl = `${GRAPH_URL}/roleManagement/directory/roleAssignments?$filter=principalId eq '${servicePrincipalId}' and roleDefinitionId eq '${roleDefinitionId}'`;
  try {
    const existing = await graphFetch(token, checkUrl);
    if (existing.value && existing.value.length > 0) {
      console.log(`[M365] ${roleLabel} role already assigned to SP ${servicePrincipalId}`);
      return { assigned: false, alreadyAssigned: true, servicePrincipalId };
    }
  } catch (err) {
    console.warn(`[M365] Could not check existing ${roleLabel} role assignments: ${(err as Error).message}`);
    // Continue and try to create — POST will fail with conflict if it already exists
  }

  // 3. Create the role assignment
  try {
    await graphFetch(token, `${GRAPH_URL}/roleManagement/directory/roleAssignments`, {
      method: 'POST',
      body: JSON.stringify({
        principalId: servicePrincipalId,
        roleDefinitionId,
        directoryScopeId: '/',
      }),
    });
    console.log(`[M365] Assigned ${roleLabel} role to SP ${servicePrincipalId}`);
    return { assigned: true, alreadyAssigned: false, servicePrincipalId };
  } catch (err) {
    const m365Err = err as M365Error;
    // Conflict / already exists
    if (
      m365Err.code === 'Request_BadRequest' &&
      (m365Err.message?.includes('already exists') || m365Err.message?.includes('conflicting object'))
    ) {
      console.log(`[M365] ${roleLabel} role already assigned (conflict) to SP ${servicePrincipalId}`);
      return { assigned: false, alreadyAssigned: true, servicePrincipalId };
    }
    throw err;
  }
}

/**
 * Ensure our app's SP has "Exchange Recipient Administrator" so it can manage
 * shared mailboxes via EXO REST. Without this, EXO returns:
 *   "The role assigned to application <id> isn't supported in this scenario"
 */
export async function ensureExchangeRecipientAdminRole(
  token: string
): Promise<{ assigned: boolean; alreadyAssigned: boolean; servicePrincipalId: string }> {
  return ensureDirectoryRoleForSelf(token, EXCHANGE_RECIPIENT_ADMIN_ROLE_ID, 'Exchange Recipient Admin');
}

/**
 * Ensure our app's SP has "User Administrator" so it can reset passwords on
 * app-created users via PATCH /users/{id} with passwordProfile.
 * Graph API permissions alone don't grant this — Microsoft requires the role.
 */
export async function ensureUserAdminRole(
  token: string
): Promise<{ assigned: boolean; alreadyAssigned: boolean; servicePrincipalId: string }> {
  return ensureDirectoryRoleForSelf(token, USER_ADMIN_ROLE_ID, 'User Administrator');
}

/**
 * Ensure our app's SP has "Exchange Administrator" so it can run tenant-wide
 * EXO cmdlets via InvokeCommand (e.g. Set-TransportConfig). Exchange Recipient
 * Administrator is NOT sufficient — that role only covers per-mailbox ops.
 */
export async function ensureExchangeAdminRole(
  token: string
): Promise<{ assigned: boolean; alreadyAssigned: boolean; servicePrincipalId: string }> {
  return ensureDirectoryRoleForSelf(token, EXCHANGE_ADMIN_ROLE_ID, 'Exchange Administrator');
}

/**
 * Ensure the Exchange Online service principal exists on the target tenant.
 *
 * /adminconsent fails with AADSTS650052 if the app has Exchange Online API
 * permissions but the tenant doesn't have the Exchange Online SP provisioned.
 * This can happen on new tenants where Exchange is included in the license
 * but the SP hasn't been auto-created yet.
 *
 * Creates it via POST /servicePrincipals if missing.
 * Requires: Application.ReadWrite.All (already in our Graph permission set).
 */
export async function ensureExoServicePrincipal(token: string): Promise<{ created: boolean; exists: boolean }> {
  // Check if the EXO SP already exists
  try {
    const filterUrl = `${GRAPH_URL}/servicePrincipals?$filter=appId eq '${EXO_SERVICE_APP_ID}'&$select=id,appId,displayName`;
    const data = await graphFetch(token, filterUrl);
    if (data.value && data.value.length > 0) {
      console.log(`[M365] Exchange Online SP already exists: ${data.value[0].id}`);
      return { created: false, exists: true };
    }
  } catch (err) {
    console.warn(`[M365] Failed to check EXO SP: ${(err as Error).message}`);
    // Continue to try creating it
  }

  // Create the EXO SP
  try {
    const createData = await graphFetch(token, `${GRAPH_URL}/servicePrincipals`, {
      method: 'POST',
      body: JSON.stringify({ appId: EXO_SERVICE_APP_ID }),
    });
    console.log(`[M365] Created Exchange Online SP: ${createData.id}`);
    return { created: true, exists: true };
  } catch (err) {
    const m365Err = err as M365Error;
    // "Request_MultipleObjectsWithSameKeyValue" means it already exists (race condition)
    if (m365Err.code === 'Request_MultipleObjectsWithSameKeyValue' || m365Err.message?.includes('already exists')) {
      console.log('[M365] Exchange Online SP already exists (conflict)');
      return { created: false, exists: true };
    }
    console.error(`[M365] Failed to create EXO SP: ${m365Err.message}`);
    return { created: false, exists: false };
  }
}

// ============================================================================
// Helper: Graph API Fetch
// ============================================================================

async function graphFetch(
  token: string,
  url: string,
  options: RequestInit = {}
): Promise<any> {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    const errorText = await res.text();
    let errorCode = 'GRAPH_ERROR';
    let message = errorText;

    try {
      const errorJson = JSON.parse(errorText);
      errorCode = errorJson.error?.code || errorCode;
      message = errorJson.error?.message || message;
    } catch { /* not JSON */ }

    throw new M365Error(errorCode, message, res.status);
  }

  // 204 No Content
  if (res.status === 204) return null;

  return res.json();
}

// ============================================================================
// Organization
// ============================================================================

/**
 * Get tenant organization details. Used to validate that consent was granted.
 */
export async function getTenantOrganization(token: string): Promise<{ displayName: string; id: string }> {
  const data = await graphFetch(token, `${GRAPH_URL}/organization`);
  const org = data.value?.[0];
  if (!org) throw new M365Error('ORG_NOT_FOUND', 'Could not retrieve organization details');
  return { displayName: org.displayName, id: org.id };
}

// ============================================================================
// Domain Management
// ============================================================================

/**
 * Add a custom domain to the M365 tenant.
 * Returns the domain resource ID.
 */
export async function addDomainToTenant(token: string, domain: string): Promise<{ id: string }> {
  const data = await graphFetch(token, `${GRAPH_URL}/domains`, {
    method: 'POST',
    body: JSON.stringify({ id: domain }),
  });
  return { id: data.id };
}

/**
 * Get DNS verification records needed to prove domain ownership to Microsoft.
 */
export async function getDomainVerificationRecords(token: string, domain: string): Promise<M365DnsRecord[]> {
  const data = await graphFetch(token, `${GRAPH_URL}/domains/${encodeURIComponent(domain)}/verificationDnsRecords`);
  return (data.value || []) as M365DnsRecord[];
}

/**
 * Get service configuration DNS records (MX, SPF, CNAME for email routing).
 * These are needed AFTER verification to actually route mail.
 */
export async function getDomainServiceRecords(token: string, domain: string): Promise<M365DnsRecord[]> {
  const data = await graphFetch(token, `${GRAPH_URL}/domains/${encodeURIComponent(domain)}/serviceConfigurationRecords`);
  return (data.value || []) as M365DnsRecord[];
}

/**
 * Trigger domain verification. Microsoft checks that DNS records have been added.
 * Returns whether the domain is now verified.
 */
export async function verifyDomain(token: string, domain: string): Promise<{ isVerified: boolean }> {
  try {
    const data = await graphFetch(token, `${GRAPH_URL}/domains/${encodeURIComponent(domain)}/verify`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    return { isVerified: data.isVerified === true };
  } catch (err) {
    // "Domain is already verified" — MS returns 400 Request_BadRequest for this case
    if (err instanceof M365Error && err.code === 'Request_BadRequest' && err.message?.includes('already verified')) {
      console.log(`[M365] Domain ${domain} is already verified — treating as success`);
      return { isVerified: true };
    }
    throw err;
  }
}

/**
 * Check current domain status without triggering verification.
 */
export async function getDomainStatus(token: string, domain: string): Promise<{ isVerified: boolean; id: string }> {
  const data = await graphFetch(token, `${GRAPH_URL}/domains/${encodeURIComponent(domain)}`);
  return { isVerified: data.isVerified === true, id: data.id };
}

/**
 * Delete a domain from the tenant.
 * All users on the domain must be deleted first.
 */
export async function deleteDomain(token: string, domain: string): Promise<void> {
  await graphFetch(token, `${GRAPH_URL}/domains/${encodeURIComponent(domain)}`, {
    method: 'DELETE',
  });
}

/**
 * Remove a domain from a tenant even while objects still reference it.
 *
 * Plain DELETE /domains/{id} is refused while any user, group or proxy address
 * uses the domain — which is always the case for a domain carrying mailboxes.
 * forceDelete renames those references to the tenant's .onmicrosoft.com domain
 * and removes the domain asynchronously. Poll getDomainOrNull() until it returns
 * null before adding the domain to another tenant: an M365 domain can be verified
 * in only one tenant at a time.
 */
export async function forceDeleteDomain(token: string, domain: string): Promise<void> {
  await graphFetch(token, `${GRAPH_URL}/domains/${encodeURIComponent(domain)}/forceDelete`, {
    method: 'POST',
    body: JSON.stringify({ disableUserAccounts: false }),
  });
}

/** The domain as this tenant sees it, or null when the tenant no longer has it. */
export async function getDomainOrNull(
  token: string,
  domain: string,
): Promise<{ id: string; isVerified: boolean } | null> {
  try {
    const d = await graphFetch(token, `${GRAPH_URL}/domains/${encodeURIComponent(domain)}`);
    return { id: d.id, isVerified: d.isVerified === true };
  } catch (err) {
    if (err instanceof M365Error && err.status === 404) return null;
    throw err;
  }
}

/**
 * List all domains in the tenant.
 */
export async function listTenantDomains(token: string): Promise<M365TenantDomain[]> {
  const data = await graphFetch(token, `${GRAPH_URL}/domains`);
  return (data.value || []) as M365TenantDomain[];
}

// ============================================================================
// User / Mailbox Management
// ============================================================================

/**
 * Create an M365 user (creates an Exchange Online mailbox automatically).
 */
export async function createM365User(token: string, params: CreateUserParams): Promise<{ id: string; userPrincipalName: string }> {
  const data = await graphFetch(token, `${GRAPH_URL}/users`, {
    method: 'POST',
    body: JSON.stringify({
      displayName: params.displayName,
      mailNickname: params.mailNickname,
      userPrincipalName: params.userPrincipalName,
      passwordProfile: {
        password: params.password,
        forceChangePasswordNextSignIn: false,
      },
      accountEnabled: true,
      usageLocation: params.usageLocation || 'GB',
    }),
  });
  return { id: data.id, userPrincipalName: data.userPrincipalName };
}

/**
 * Delete an M365 user (also removes their Exchange mailbox).
 */
export async function deleteM365User(token: string, userId: string): Promise<void> {
  await graphFetch(token, `${GRAPH_URL}/users/${userId}`, {
    method: 'DELETE',
  });
}

/**
 * List users on a specific domain.
 */
export async function listDomainUsers(token: string, domain: string): Promise<Array<{ id: string; userPrincipalName: string; displayName: string }>> {
  const filter = encodeURIComponent(`endsWith(userPrincipalName,'@${domain}')`);
  const data = await graphFetch(token, `${GRAPH_URL}/users?$filter=${filter}&$select=id,userPrincipalName,displayName`);
  return (data.value || []) as Array<{ id: string; userPrincipalName: string; displayName: string }>;
}

// ============================================================================
// Shared Mailbox Management
// ============================================================================

// Exchange Online Admin API — required for shared mailbox operations that MS Graph doesn't expose:
// - Creating actual shared mailboxes (not just disabled users)
// - Granting Send As / Full Access permissions
// Requires: Exchange.ManageAsApp application permission + Exchange Admin role
const EXO_ADMIN_URL = 'https://outlook.office.com/adminapi/beta';

async function exoFetch(token: string, path: string, options: RequestInit = {}): Promise<any> {
  const url = `${EXO_ADMIN_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const errorText = await res.text();
    let message = `HTTP ${res.status} from ${url}: ${errorText || '(empty body)'}`;
    try {
      const json = JSON.parse(errorText);
      message = json?.error?.message || json?.Message || json?.message || message;
    } catch { /* not JSON, use raw */ }
    throw new M365Error('EXO_ERROR', message, res.status);
  }
  if (res.status === 204) return null;
  return res.json();
}

/**
 * Detect EXO "object not found on replica" errors caused by directory
 * replication lag between EXO regions/replicas. After a POST creates a
 * mailbox on one replica, a subsequent PATCH/GET may be routed to a different
 * replica that hasn't received the new object yet.
 *
 * The error shape varies by code path:
 *   - HTTP 404 "Resource not found"
 *   - HTTP 400 "object 'foo@bar' couldn't be found on 'LO...prod.outlook.com'" (cmdlet pipeline)
 *   - ManagementObjectNotFoundException in the JSON envelope
 */
function isExoReplicaLagError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('404') ||
    msg.includes('not found') ||
    msg.includes('NotFound') ||
    msg.includes("couldn't be found") ||
    msg.includes('ManagementObjectNotFoundException')
  );
}

/**
 * Retry an EXO call up to 18 times (~180s total) when the replica answering
 * the request hasn't seen the new mailbox yet. Other errors propagate immediately.
 */
async function exoRetryOnReplicaLag<T>(
  fn: () => Promise<T>,
  label: string,
  maxAttempts = 18,
  delayMs = 10000,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isExoReplicaLagError(err) || attempt === maxAttempts) throw err;
      console.log(`[M365] ${label}: replica lag (attempt ${attempt}/${maxAttempts}), waiting ${delayMs}ms...`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

/**
 * Create a real shared mailbox via the Exchange Online Admin API.
 *
 * Shared mailboxes cost $0/month (no Exchange Online license required, up to
 * 50GB) and are what Plusvibe and similar warmup tools expect. The underlying
 * user account is still created in Entra; SMTP AUTH works after
 * resetMailboxPassword() sets a usable password on that user.
 *
 * Flow:
 *   1. POST /Mailbox  — EXO creates the mailbox as Type: UserMailbox (Regular).
 *      The Admin API has no "create as Shared" verb.
 *   2. PATCH /Mailbox('...') { Type: 'Shared' }  — convert to Shared. This is
 *      the step Microsoft requires; without it the mailbox remains a regular
 *      user mailbox that needs a per-seat Exchange Online license and gets
 *      SMTP-throttled by Microsoft once the trial grace period expires.
 *   3. Read back RecipientTypeDetails  — fail loudly if the conversion did
 *      not stick, so we never silently leave billable Regular mailboxes around.
 *
 * Requires: Exchange.ManageAsApp + Exchange Administrator role on the app.
 */
export async function createSharedMailbox(
  token: string,
  tenantId: string,
  params: {
    displayName: string;
    mailNickname: string;
    emailAddress: string;
  }
): Promise<{ id: string; userPrincipalName: string }> {
  let mailboxId: string;
  let upn: string;

  // Step 1: Create the mailbox. EXO creates it as Type: UserMailbox; we convert
  // in step 2. If it already exists from a prior failed attempt, fetch it.
  try {
    const data = await exoFetch(token, `/${tenantId}/Mailbox`, {
      method: 'POST',
      body: JSON.stringify({
        // Name is EXO's internal object identifier and must be unique tenant-wide
        // (not just per-domain) — unlike DisplayName, it's not shown to recipients.
        // Derive it from emailAddress (already guaranteed unique, see catch below)
        // rather than the human display name, since two domains on the same tenant
        // can otherwise pick the same person name and collide on Name even though
        // their email addresses differ.
        Name: params.emailAddress,
        DisplayName: params.displayName,
        Alias: params.mailNickname,
        MicrosoftOnlineServicesID: params.emailAddress,
      }),
    });
    mailboxId = data.ExternalDirectoryObjectId || data.Guid;
    upn = data.PrimarySmtpAddress || params.emailAddress;
    console.log(`[M365] Created mailbox ${upn} (id: ${mailboxId})`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('proxy address') && msg.includes('already being used')) {
      console.log(`[M365] Mailbox ${params.emailAddress} already exists — fetching existing`);
      const existing = await exoFetch(token, `/${tenantId}/Mailbox('${encodeURIComponent(params.emailAddress)}')?$select=ExternalDirectoryObjectId,PrimarySmtpAddress`);
      mailboxId = existing.ExternalDirectoryObjectId || existing.Guid;
      upn = existing.PrimarySmtpAddress || params.emailAddress;
      console.log(`[M365] Using existing mailbox ${upn} (id: ${mailboxId})`);
    } else {
      throw e;
    }
  }

  // Step 2: Convert to Shared. PATCH is idempotent — re-running on an already
  // Shared mailbox is a no-op.
  //
  // EXO replica lag: the POST in step 1 commits to one directory replica, but
  // the PATCH below may be routed to a different replica that hasn't seen the
  // new mailbox yet. That replica returns "object 'X' couldn't be found on
  // 'LO...prod.outlook.com'" as HTTP 400. Retry until it propagates, otherwise
  // we orphan the mailbox in EXO (created but never converted, no DB row).
  await exoRetryOnReplicaLag(
    () => exoFetch(token, `/${tenantId}/Mailbox('${encodeURIComponent(upn)}')`, {
      method: 'PATCH',
      body: JSON.stringify({ Type: 'Shared' }),
    }),
    `PATCH Type:Shared for ${upn}`,
  );
  console.log(`[M365] Converted ${upn} to Type: Shared`);

  // Step 3: Verify the conversion landed. EXO is eventually consistent, so
  // give the change a moment then read back RecipientTypeDetails.
  await new Promise((r) => setTimeout(r, 1500));
  const verify = await exoRetryOnReplicaLag(
    () => exoFetch(
      token,
      `/${tenantId}/Mailbox('${encodeURIComponent(upn)}')?$select=RecipientTypeDetails,PrimarySmtpAddress`
    ),
    `verify RecipientTypeDetails for ${upn}`,
  );
  const recipientType: string | undefined = verify?.RecipientTypeDetails;
  if (recipientType !== 'SharedMailbox') {
    throw new M365Error(
      'SHARED_CONVERSION_FAILED',
      `Mailbox ${upn} did not convert to SharedMailbox (current type: ${recipientType ?? 'unknown'}). ` +
        `Leaving as a regular mailbox would require a per-seat Exchange Online license and will be SMTP-throttled by Microsoft.`
    );
  }
  console.log(`[M365] Verified ${upn} RecipientTypeDetails=${recipientType}`);

  return { id: mailboxId, userPrincipalName: upn };
}

/**
 * Invoke an Exchange Online cmdlet via the EXO Admin REST API's InvokeCommand
 * endpoint. This is the bridge that lets us run any Set/Get cmdlet over
 * REST instead of PowerShell remoting.
 *
 * Requires the X-AnchorMailbox header for app-only auth — we use the tenant's
 * built-in SystemMailbox UPN since there is no user context.
 */
export async function exoInvokeCommand(
  token: string,
  tenantId: string,
  onmicrosoftDomain: string,
  cmdletName: string,
  parameters: Record<string, unknown> = {}
): Promise<any> {
  const url = `${EXO_ADMIN_URL}/${tenantId}/InvokeCommand`;
  const anchor = `UPN:SystemMailbox{bb558c35-97f1-4cb9-8ff7-d53741dc928c}@${onmicrosoftDomain}`;
  // Disable compression — Deno fetch's auto-decompression chokes on the EXO
  // InvokeCommand response (we get "Invalid gzip header" otherwise).
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Accept-Encoding': 'identity',
      'X-ResponseFormat': 'json',
      'X-AnchorMailbox': anchor,
    },
    body: JSON.stringify({
      CmdletInput: {
        CmdletName: cmdletName,
        Parameters: parameters,
      },
    }),
  });
  if (!res.ok) {
    const errorText = await res.text();
    let message = `HTTP ${res.status} from InvokeCommand(${cmdletName}): ${errorText || '(empty body)'}`;
    try {
      const json = JSON.parse(errorText);
      message = json?.error?.message || json?.Message || json?.message || message;
    } catch { /* not JSON */ }
    throw new M365Error('EXO_INVOKE_ERROR', message, res.status);
  }
  if (res.status === 204) return null;
  return res.json();
}

/**
 * Enable SMTP AUTH at the tenant level via Set-TransportConfig.
 *
 * Microsoft disables SMTP AUTH at the tenant level by default for new M365
 * tenants (since 2022 security baseline). Even when SMTP AUTH is enabled
 * per-mailbox via CASMailbox, login still fails with:
 *   "535 5.7.139 Authentication unsuccessful, SmtpClientAuthentication is
 *    disabled for the Tenant"
 * unless `SmtpClientAuthenticationDisabled` is set to false on TransportConfig.
 *
 * Calls Get-TransportConfig first; only writes if currently disabled.
 * Requires the Exchange Administrator directory role on our app's SP
 * (Exchange Recipient Administrator is NOT sufficient for tenant-wide cmdlets).
 */
export async function ensureTenantSmtpAuthEnabled(
  token: string,
  tenantId: string,
  onmicrosoftDomain: string
): Promise<{ wasDisabled: boolean; nowEnabled: boolean }> {
  // Read current TransportConfig
  let current: any;
  try {
    current = await exoInvokeCommand(token, tenantId, onmicrosoftDomain, 'Get-TransportConfig', {});
  } catch (e) {
    console.warn(`[M365] Could not read TransportConfig for tenant ${tenantId}: ${(e as Error).message}`);
    throw e;
  }

  // InvokeCommand returns { value: [ { ... } ] } or { value: { ... } } depending on cmdlet
  const config = Array.isArray(current?.value) ? current.value[0] : (current?.value || current);
  const currentlyDisabled = config?.SmtpClientAuthenticationDisabled === true;
  if (!currentlyDisabled) {
    console.log(`[M365] Tenant SMTP AUTH already enabled for ${tenantId}`);
    return { wasDisabled: false, nowEnabled: true };
  }

  // Run Set-TransportConfig -SmtpClientAuthenticationDisabled $false
  await exoInvokeCommand(token, tenantId, onmicrosoftDomain, 'Set-TransportConfig', {
    SmtpClientAuthenticationDisabled: false,
  });
  console.log(`[M365] Enabled tenant-level SMTP AUTH for ${tenantId}`);
  return { wasDisabled: true, nowEnabled: true };
}

/**
 * Delete a shared mailbox via EXO Admin API.
 */
export async function deleteSharedMailbox(token: string, tenantId: string, mailboxEmail: string): Promise<void> {
  await exoFetch(token, `/${tenantId}/Mailbox('${encodeURIComponent(mailboxEmail)}')`, {
    method: 'DELETE',
  });
}

/**
 * Reset the password on a shared mailbox via MS Graph.
 * Shared mailboxes are created without a usable password; resetting it allows
 * direct SMTP AUTH and IMAP login as the shared mailbox itself.
 *
 * Requires: User.ReadWrite.All (already in our permission set)
 */
export async function resetMailboxPassword(graphToken: string, userId: string, newPassword: string): Promise<void> {
  await graphFetch(graphToken, `${GRAPH_URL}/users/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      passwordProfile: {
        password: newPassword,
        forceChangePasswordNextSignIn: false,
      },
      accountEnabled: true,
    }),
  });
  console.log(`[M365] Password reset for user ${userId}`);
}

/**
 * @deprecated MailboxPermission/RecipientPermission are not exposed by the EXO Admin REST API.
 * Kept for reference — no-op so callers don't break during transition.
 */
export async function grantSendAs(
  _token: string,
  _tenantId: string,
  _sharedMailboxEmail: string,
  _delegateUserEmail: string
): Promise<void> {
  // EXO Admin REST API does not expose MailboxPermission or RecipientPermission endpoints.
  // Instead we use direct SMTP AUTH on the shared mailbox after resetting its password.
  console.log('[M365] grantSendAs: skipped (EXO permission endpoints not available via REST API)');
}

/**
 * List all shared mailboxes on a specific domain in the tenant.
 */
export async function listSharedMailboxes(
  token: string,
  tenantId: string,
  domain: string
): Promise<Array<{ id: string; userPrincipalName: string; displayName: string }>> {
  const filter = encodeURIComponent(`RecipientTypeDetails eq 'SharedMailbox' and endsWith(PrimarySmtpAddress,'@${domain}')`);
  const data = await exoFetch(token, `/${tenantId}/Mailbox?$filter=${filter}&$select=ExternalDirectoryObjectId,PrimarySmtpAddress,DisplayName`);
  return ((data.value || []) as Array<Record<string, string>>).map(m => ({
    id: m.ExternalDirectoryObjectId,
    userPrincipalName: m.PrimarySmtpAddress,
    displayName: m.DisplayName,
  }));
}

/**
 * Resolve an email address to its Entra user object ID via Graph.
 * Used to get the GUID needed for enableSmtpAuth.
 */
export async function resolveUserIdByEmail(token: string, email: string): Promise<string> {
  const data = await graphFetch(token, `${GRAPH_URL}/users/${encodeURIComponent(email)}?$select=id`);
  if (!data?.id) throw new M365Error('USER_NOT_FOUND', `Could not resolve user ID for ${email}`);
  return data.id as string;
}

/**
 * Check if Security Defaults are enabled on the tenant.
 * Security Defaults block Basic Auth SMTP/IMAP — must be disabled for this model to work.
 */
export async function getSecurityDefaultsEnabled(token: string): Promise<boolean | null> {
  try {
    const data = await graphFetch(token, `${GRAPH_URL}/policies/identitySecurityDefaultsEnforcementPolicy`);
    return data?.isEnabled === true;
  } catch (e) {
    console.warn(`[M365] Could not read Security Defaults policy (missing Policy.Read.All?): ${(e as Error).message}`);
    return null; // null = unknown (permission error), distinct from false (confirmed disabled)
  }
}

/**
 * Disable Security Defaults on the tenant. Idempotent.
 *
 * Security Defaults is Microsoft's blanket "block all legacy auth" policy.
 * It overrides everything: while enabled, the M365 admin center won't even
 * show the "Authenticated SMTP" toggle, and SMTP AUTH login is rejected.
 *
 * SECURITY IMPLICATIONS: disabling Security Defaults removes blanket MFA
 * enforcement. For production customer tenants, you'll want a Conditional
 * Access policy enforcing MFA on user logins. We don't auto-create CA policies
 * because they require careful design (admin exclusions, service account
 * exemptions, conflict avoidance with existing policies). The wizard surfaces
 * a warning to the customer about this.
 *
 * Requires Graph permission: Policy.ReadWrite.ConditionalAccess (Application).
 */
export async function ensureSecurityDefaultsDisabled(
  token: string
): Promise<{ wasEnabled: boolean; nowDisabled: boolean }> {
  let current: any;
  try {
    current = await graphFetch(token, `${GRAPH_URL}/policies/identitySecurityDefaultsEnforcementPolicy`);
  } catch (e) {
    console.warn(`[M365] Could not read Security Defaults policy: ${(e as Error).message}`);
    throw e;
  }

  if (current?.isEnabled !== true) {
    console.log('[M365] Security Defaults already disabled');
    return { wasEnabled: false, nowDisabled: true };
  }

  console.log('[M365] Security Defaults is enabled, attempting to disable...');
  await graphFetch(token, `${GRAPH_URL}/policies/identitySecurityDefaultsEnforcementPolicy`, {
    method: 'PATCH',
    body: JSON.stringify({ isEnabled: false }),
  });

  // Verify the write took effect - Graph can accept the PATCH but not apply it
  // (e.g. insufficient permissions that only manifest as a silent no-op)
  await new Promise(r => setTimeout(r, 1000));
  try {
    const after = await graphFetch(token, `${GRAPH_URL}/policies/identitySecurityDefaultsEnforcementPolicy`);
    if (after?.isEnabled === true) {
      console.error('[M365] Security Defaults PATCH accepted but policy is still enabled - likely missing Policy.ReadWrite.ConditionalAccess permission');
      throw new M365Error('SECURITY_DEFAULTS_STILL_ENABLED', 'Security Defaults could not be disabled programmatically. The PATCH was accepted but the policy remains enabled. Disable manually in Entra ID > Overview > Properties > Manage security defaults.');
    }
  } catch (e) {
    if (e instanceof M365Error && e.code === 'SECURITY_DEFAULTS_STILL_ENABLED') throw e;
    console.warn(`[M365] Could not verify Security Defaults state after PATCH: ${(e as Error).message}`);
  }

  console.log('[M365] Disabled Security Defaults (verified)');
  return { wasEnabled: true, nowDisabled: true };
}

// ============================================================================
// SMTP AUTH Enablement
// ============================================================================

/**
 * Enable SMTP AUTH (and IMAP) for a specific mailbox.
 *
 * Uses EXO Admin REST API's CASMailbox endpoint (SmtpClientAuthenticationDisabled=false).
 * Polls until the mailbox is provisioned (Exchange can take 2-3 minutes after creation,
 * especially in EU tenants). Addresses CASMailbox by the Graph user GUID when available
 * to avoid the proxyAddress index race that produces 404s on fresh shared mailboxes.
 *
 * There is no Graph API equivalent for toggling SMTP AUTH; this is EXO-only. If EXO
 * credentials are not supplied, the function logs a warning and returns without throwing.
 *
 * NOTE: Tenant-level SMTP AUTH must also be enabled:
 * M365 Admin Center > Settings > Org Settings > Modern authentication > uncheck "Disable SMTP AUTH"
 */
export async function enableSmtpAuth(
  _graphToken: string,
  userId: string,
  exoToken?: string,
  tenantId?: string,
  mailboxEmail?: string,
  noRetry = false,
): Promise<void> {
  if (!exoToken || !tenantId || (!userId && !mailboxEmail)) {
    console.warn(
      `[M365] SMTP AUTH skipped: missing EXO credentials or identifier (mailbox=${mailboxEmail ?? 'unknown'}). ` +
        `Re-run the mailbox repair flow once EXO consent is granted.`,
    );
    return;
  }

  // Prefer the Graph user GUID — it's propagated to EXO directory before the SMTP
  // proxyAddress index is, so it avoids the "object couldn't be found" 404 race.
  const identity = userId || mailboxEmail!;
  // noRetry=true for repair (mailbox already exists, no need to poll)
  // noRetry=false for creation (mailbox may not be ready yet, poll up to 18x = 180s)
  const maxAttempts = noRetry ? 1 : 18;
  const delayMs = 10000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await exoFetch(exoToken, `/${tenantId}/CASMailbox('${encodeURIComponent(identity)}')`, {
        method: 'PATCH',
        body: JSON.stringify({
          SmtpClientAuthenticationDisabled: false,
          ImapEnabled: true,
          PopEnabled: false,
        }),
      });
      console.log(`[M365] SMTP AUTH + IMAP enabled via EXO CASMailbox for ${mailboxEmail ?? identity}`);
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // EXO replication lag returns several distinguishable shapes depending on
      // which replica answers and whether the request hits the REST shim or the
      // cmdlet pipeline:
      //   - HTTP 404 "Resource not found"
      //   - "object 'foo@bar' couldn't be found on 'LO...prod.outlook.com'" (cmdlet, HTTP 400)
      //   - ManagementObjectNotFoundException in the error envelope
      // All three mean "this replica hasn't seen the new mailbox yet" — retry.
      const isNotReady =
        msg.includes('404') ||
        msg.includes('not found') ||
        msg.includes('NotFound') ||
        msg.includes("couldn't be found") ||
        msg.includes('ManagementObjectNotFoundException');
      if (!noRetry && attempt < maxAttempts && isNotReady) {
        console.log(`[M365] CASMailbox attempt ${attempt}/${maxAttempts}: not ready yet, waiting ${delayMs}ms...`);
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      console.warn(
        `[M365] EXO CASMailbox failed for ${mailboxEmail ?? identity} (non-fatal): ${msg}. ` +
          `Mailbox was created but SMTP AUTH is NOT enabled — re-run the mailbox repair flow before sending.`,
      );
      return;
    }
  }
}

// ============================================================================
// Password Generation
// ============================================================================

/**
 * Generate a strong password meeting Exchange Online requirements:
 * - At least 8 characters
 * - Uppercase, lowercase, digit, special character
 */
export function generateMailboxPassword(): string {
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lower = 'abcdefghijklmnopqrstuvwxyz';
  const digits = '0123456789';
  const special = '!@#$%^&*';
  const all = upper + lower + digits + special;

  // Ensure at least one of each required type
  const required = [
    upper[Math.floor(Math.random() * upper.length)],
    lower[Math.floor(Math.random() * lower.length)],
    digits[Math.floor(Math.random() * digits.length)],
    special[Math.floor(Math.random() * special.length)],
  ];

  // Fill remaining 12 characters
  const remaining = Array.from({ length: 12 }, () => all[Math.floor(Math.random() * all.length)]);

  // Shuffle
  const combined = [...required, ...remaining];
  for (let i = combined.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [combined[i], combined[j]] = [combined[j], combined[i]];
  }

  return combined.join('');
}

// ============================================================================
// DNS Record Transformation
// ============================================================================

/**
 * Transform MS Graph DNS records into the DnsRecord[] format used by the UI
 * and email_sending_domains.dns_records column.
 *
 * Combines verification records (for proving ownership) and
 * service configuration records (for email routing) into one list.
 */
export function generateM365DnsRecords(
  domain: string,
  verificationRecords: M365DnsRecord[],
  serviceRecords: M365DnsRecord[],
  /**
   * Where DMARC aggregate reports should go. Defaults to dmarc@<domain> for
   * backward compat, but that mailbox is never actually provisioned anywhere
   * in the M365 provisioning flow — every domain that got this default has
   * had 100% of its rua reports silently bounced. Callers with an org-level
   * shared collector (dmarc_collector_mailboxes) should always pass its
   * email_address instead. See project_dmarc_rua_never_delivered.
   */
  dmarcRuaOverride?: string,
): DnsRecord[] {
  const records: DnsRecord[] = [];

  const transformRecord = (record: M365DnsRecord, description?: string): DnsRecord | null => {
    // Graph returns label as '@' or the full domain or a subdomain prefix.
    // Normalize: if label is '@', empty, or the full domain itself → use domain as name
    const rawLabel = record.label || '@';
    const isRoot = rawLabel === '@' || rawLabel === '' || rawLabel === domain || rawLabel.toLowerCase() === domain.toLowerCase();
    const name = isRoot ? domain : (rawLabel.endsWith(`.${domain}`) ? rawLabel : `${rawLabel}.${domain}`);

    // Graph TXT records have multiple possible shapes:
    //   verificationDnsRecords: { text: "MS=ms..." }  (direct string)
    //   serviceConfigurationRecords: { additionalProperties: { text: "v=spf1..." } }
    //   Legacy fallback: { text: { text: "..." } }     (nested object)
    let txtValue = '';
    if (typeof record.text === 'string') {
      txtValue = record.text;
    } else if (typeof record.text === 'object' && record.text !== null) {
      txtValue = (record.text as { text: string }).text ?? '';
    }
    if (!txtValue && record.additionalProperties?.text) {
      txtValue = String(record.additionalProperties.text);
    }

    // Skip incomplete MS= ownership records (Graph sometimes returns partial value before indexing)
    if (record.recordType === 'Txt' && txtValue === 'MS=') return null;

    if (record.recordType === 'Txt' && txtValue) {
      return {
        type: 'TXT',
        name,
        value: txtValue,
        ttl: record.ttl || 3600,
        verified: false,
        description: description || getDnsDescription(record),
      };
    }

    // Graph returns MX fields as flat properties (mailExchange/preference), with mxRecord as legacy fallback
    const mailExchange = record.mailExchange ?? record.mxRecord?.mailExchange;
    const preference = record.preference ?? record.mxRecord?.preference;
    if (record.recordType === 'Mx' && mailExchange) {
      return {
        type: 'MX',
        name,
        value: mailExchange,
        priority: preference ?? 0,
        ttl: record.ttl || 3600,
        verified: false,
        description: description || 'MX — routes inbound email to Exchange Online. Delete any existing MX records on this domain first.',
      };
    }

    // Graph returns CNAME target as flat canonicalName, with cnameRecord as legacy fallback
    const canonicalName = record.canonicalName ?? record.cnameRecord?.canonicalName;
    if (record.recordType === 'CName' && canonicalName) {
      return {
        type: 'CNAME',
        name,
        value: canonicalName,
        ttl: record.ttl || 3600,
        verified: false,
        description: description || getDnsDescription(record),
      };
    }

    return null;
  };

  // Add verification records first (TXT for domain ownership)
  // Skip the placeholder MX (.msv1.invalid) — that's Microsoft's pre-verification sentinel, not a real record.
  for (const vr of verificationRecords) {
    const mxTarget = vr.mailExchange ?? vr.mxRecord?.mailExchange ?? '';
    if (vr.recordType === 'Mx' && mxTarget.includes('msv1.invalid')) continue;
    const rec = transformRecord(vr, 'Domain ownership verification — add this TXT record to prove you control this domain');
    if (rec) records.push(rec);
  }

  // Add service configuration records (MX, SPF, Autodiscover CNAME)
  // Only include Email-related records — skip Teams/Skype/SharePoint/Intune records.
  for (const sr of serviceRecords) {
    if (sr.supportedService !== 'Email') continue;
    const rec = transformRecord(sr);
    if (rec) records.push(rec);
  }

  // Add DMARC record (not provided by Microsoft, recommended for deliverability)
  records.push({
    type: 'TXT',
    name: `_dmarc.${domain}`,
    value: `v=DMARC1; p=quarantine; rua=mailto:${dmarcRuaOverride || `dmarc@${domain}`}`,
    ttl: 3600,
    verified: false,
    description: 'DMARC — email authentication policy (quarantine unauthorized mail)',
  });

  return records;
}

// ============================================================================
// DKIM Management (Exchange Online REST API — not MS Graph)
// ============================================================================

export interface DkimSigningConfig {
  Domain: string;
  Enabled: boolean;
  Selector1CNAME: string | null;   // e.g. selector1-acme-com._domainkey.acme-com.onmicrosoft.com
  Selector2CNAME: string | null;
  Status: string;                  // 'Valid', 'CnameMissing', 'UpdatedToPendingVerification', etc.
}

/**
 * Get an Exchange Online token for DKIM operations.
 * Uses the full app (M365_APP_CLIENT_ID) which has Exchange.ManageAsApp permission.
 */
async function getExoToken(tenantId: string): Promise<string> {
  const credentials = getAppCredentials();
  return getTokenWithCredentials(tenantId, 'https://outlook.office365.com/.default', credentials);
}

/**
 * Invoke an EXO PowerShell cmdlet via the REST InvokeCommand endpoint.
 * Returns the first result object or null on failure.
 *
 * IMPORTANT: failures are logged before being swallowed. A silent null here used
 * to mask the cause of the legacy-DKIM-fallback bug (keplerpixel.com, 2026-05).
 * Callers still see `null` and decide what to do; the logs let us diagnose.
 */
async function invokeExoCmdlet(tenantId: string, cmdletName: string, params: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  let token: string;
  try {
    token = await getExoToken(tenantId);
  } catch (err) {
    console.warn(`[M365 EXO] ${cmdletName} (tenant=${tenantId}): token fetch failed: ${(err as Error).message}`);
    return null;
  }

  let resp: Response;
  try {
    resp = await fetch(`https://outlook.office365.com/adminapi/beta/${tenantId}/InvokeCommand`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ CmdletInput: { CmdletName: cmdletName, Parameters: params } }),
    });
  } catch (err) {
    console.warn(`[M365 EXO] ${cmdletName} (tenant=${tenantId}): fetch threw: ${(err as Error).message}`);
    return null;
  }

  if (!resp.ok) {
    const body = await resp.text().catch(() => '(no body)');
    console.warn(`[M365 EXO] ${cmdletName} (tenant=${tenantId}) failed ${resp.status}: ${body.slice(0, 500)}`);
    return null;
  }

  try {
    const data = await resp.json() as { value?: Record<string, unknown>[] };
    return data.value?.[0] ?? null;
  } catch (err) {
    console.warn(`[M365 EXO] ${cmdletName} (tenant=${tenantId}): JSON parse failed: ${(err as Error).message}`);
    return null;
  }
}

/**
 * Get DKIM signing config for a domain via EXO PowerShell (Get-DkimSigningConfig).
 * Falls back gracefully if permissions aren't available.
 */
export async function getDkimSigningConfig(_token: string, tenantId: string, domain: string): Promise<DkimSigningConfig | null> {
  const result = await invokeExoCmdlet(tenantId, 'Get-DkimSigningConfig', { Identity: domain });
  if (!result || !result['Selector1CNAME']) return null;
  return {
    Domain: result['Domain'] as string,
    Enabled: result['Enabled'] as boolean,
    Selector1CNAME: result['Selector1CNAME'] as string | null,
    Selector2CNAME: result['Selector2CNAME'] as string | null,
    Status: result['Status'] as string,
  };
}

/**
 * Enable DKIM signing for a domain via EXO PowerShell.
 *
 * Idempotent flow:
 *   1. New-DkimSigningConfig  — creates the signing config if missing (no-op if it already exists)
 *   2. Set-DkimSigningConfig -Enabled $true — requires the selector CNAMEs to be live in DNS
 *   3. Get-DkimSigningConfig  — re-reads the TRUE state (Enabled + Status) after the enable attempt
 *
 * Crucial: step 2 fails silently (via invokeExoCmdlet's try/catch) when CNAMEs
 * aren't yet published at the user's registrar — EXO returns "CnameMissing".
 * We never fake the return value: the caller sees the real `Enabled` and `Status`
 * from step 3. Callers must check `Status === 'Valid'` before trusting signing is live.
 */
export async function enableDkimSigning(_token: string, tenantId: string, domain: string): Promise<DkimSigningConfig | null> {
  // 1. Create signing config if missing (idempotent — returns null if it already exists)
  await invokeExoCmdlet(tenantId, 'New-DkimSigningConfig', { DomainName: domain, Enabled: false });

  // 2. Attempt to enable signing. Silently fails if CNAMEs aren't live yet — that's fine,
  //    we'll see the truth in step 3.
  await invokeExoCmdlet(tenantId, 'Set-DkimSigningConfig', { Identity: domain, Enabled: true });

  // 3. Re-read actual state. This is the source of truth.
  const source = await invokeExoCmdlet(tenantId, 'Get-DkimSigningConfig', { Identity: domain });
  if (!source || !source['Selector1CNAME']) return null;

  return {
    Domain: source['Domain'] as string,
    Enabled: Boolean(source['Enabled']),
    Selector1CNAME: source['Selector1CNAME'] as string | null,
    Selector2CNAME: source['Selector2CNAME'] as string | null,
    Status: source['Status'] as string,
  };
}

/**
 * Build DKIM CNAME DnsRecord objects from a DkimSigningConfig.
 * These are added to dns_records after domain verification.
 */
export function buildDkimDnsRecords(domain: string, config: DkimSigningConfig): DnsRecord[] {
  const records: DnsRecord[] = [];
  if (config.Selector1CNAME) {
    records.push({
      type: 'CNAME',
      name: `selector1._domainkey.${domain}`,
      value: config.Selector1CNAME,
      ttl: 3600,
      verified: false,
      description: 'DKIM selector 1 — cryptographic email signature (add after domain verification)',
    });
  }
  if (config.Selector2CNAME) {
    records.push({
      type: 'CNAME',
      name: `selector2._domainkey.${domain}`,
      value: config.Selector2CNAME,
      ttl: 3600,
      verified: false,
      description: 'DKIM selector 2 — for key rotation (add after domain verification)',
    });
  }
  return records;
}

// ============================================================================
// Profile Photo
// ============================================================================

/**
 * Upload a profile photo to an M365 user via Graph API.
 * Downloads the image from the provided URL and PUTs it to Graph.
 * Requires User.ReadWrite.All (already in our permission set).
 */
export async function setUserProfilePhoto(
  token: string,
  userId: string,
  imageUrl: string
): Promise<void> {
  // Download image
  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) {
    throw new M365Error('PHOTO_DOWNLOAD_FAILED', `Failed to download avatar from URL (${imgRes.status})`);
  }
  const imageData = await imgRes.arrayBuffer();
  const contentType = imgRes.headers.get('content-type') || 'image/jpeg';

  // Upload to Graph
  const res = await fetch(`${GRAPH_URL}/users/${userId}/photo/$value`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': contentType,
    },
    body: imageData,
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new M365Error('PHOTO_UPLOAD_FAILED', `Graph photo upload failed (${res.status}): ${errText}`, res.status);
  }
}

function getDnsDescription(record: M365DnsRecord): string {
  const service = record.supportedService?.toLowerCase() || '';
  if (service.includes('email') || service.includes('exchange')) {
    if (record.recordType === 'Txt') return 'SPF — authorizes Microsoft Exchange Online to send email for your domain';
    if (record.recordType === 'CName') return 'Autodiscover — enables automatic email client configuration';
  }
  return `${record.recordType} record for ${record.supportedService || 'email'}`;
}
