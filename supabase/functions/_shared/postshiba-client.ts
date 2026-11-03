/**
 * PostShiba REST client (https://www.postshiba.com/docs/api-reference).
 *
 * PostShiba is BYOK: each org connects its own team (team id + API key). Team-scoped
 * paths take the obfuscated team id. Covers the connect flow (clusters, tenants, SMTP
 * credentials) and domain setup (sending domains, catch-all inboxes). Webhook calls
 * are added with the events phase.
 * Plan: tasks/postshiba-integration-2026-10-22.md.
 */

const POSTSHIBA_API = 'https://app.postshiba.com';

export class PostShibaError extends Error {
  status: number;
  code: string | null;
  constructor(status: number, code: string | null, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export interface PostShibaCluster {
  id: string;
  name: string;
  plan: string;
  classification: 'transactional' | 'bulk';
  status: string;
  sending_ready: boolean;
  emails_per_day: number;
  emails_per_hour: number;
  smtp_endpoint: string;
}

export interface PostShibaTenant {
  id: string;
  name: string;
  slug: string;
  suspended: boolean;
}

export interface PostShibaSmtpCredential {
  id: string;
  username: string;
  /** Returned once, on create. */
  password?: string;
  tenant_id: string;
  cluster_id: string;
}

export interface PostShibaSendingDomain {
  id: string;
  name: string;
  tenant_id: string;
  dkim_status: string;
  return_path_status: string;
  dmarc_status: string;
  sending_allowed: boolean;
  dkim_selector: string;
  dkim_manual: boolean;
  dkim_cname_host: string;
  dkim_cname_target: string;
  dmarc_host: string;
  dmarc_record: string;
  return_path_host: string;
  return_path_target: string;
  last_verification_error: string | null;
  suspended: boolean;
}

export interface PostShibaInbox {
  id: string;
  name: string;
  address: string;
  local_part: string;
  host: string;
  tenant_id: string;
  webhook_url: string | null;
  webhook_format: string;
  /** Returned on create and show, never on index. */
  webhook_secret?: string;
  mx_status: string;
  /** Returned on create for domain-bound inboxes, e.g. "inbound.postshiba.com". */
  mx_target?: string;
}

export interface CreateInboxInput {
  name: string;
  local_part: string;
  host: string;
  webhook_url: string;
  tenant_id: string;
}

export function createPostShibaClient(apiKey: string, teamId: string) {
  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${POSTSHIBA_API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      // REST errors are `{ error, field? }`, e.g. 422 `{ error: 'invalid', field: 'host' }`.
      const code = typeof json?.error === 'string' ? json.error : null;
      const field = typeof json?.field === 'string' ? json.field : null;
      const message = json?.message || (code && field ? `${code} (${field})` : code) || text.slice(0, 300) || res.statusText;
      throw new PostShibaError(res.status, code, message);
    }
    return json as T;
  }

  const team = `/api/v1/teams/${encodeURIComponent(teamId)}`;

  return {
    /** Live clusters of the team. Also the cheapest way to validate a key + team id. */
    listClusters: () => request<PostShibaCluster[]>('GET', `${team}/clusters`),
    /** Extra tenants (the default tenant is omitted). */
    listTenants: () => request<PostShibaTenant[]>('GET', `${team}/tenants`),
    /** Slug is generated from the name when omitted. */
    createTenant: (name: string, slug?: string) =>
      request<PostShibaTenant>('POST', `${team}/tenants`, { tenant: slug ? { name, slug } : { name } }),
    createSmtpCredential: (clusterId: string, tenantId: string) =>
      request<PostShibaSmtpCredential>(
        'POST',
        `${team}/clusters/${encodeURIComponent(clusterId)}/smtp_credentials`,
        { smtp_credential: { tenant_id: tenantId } },
      ),
    disableSmtpCredential: (clusterId: string, credentialId: string) =>
      request<PostShibaSmtpCredential>(
        'DELETE',
        `${team}/clusters/${encodeURIComponent(clusterId)}/smtp_credentials/${encodeURIComponent(credentialId)}`,
      ),

    listSendingDomains: () => request<PostShibaSendingDomain[]>('GET', `${team}/sending_domains`),
    /** Name must be a fully qualified host. Queues a DNS check. */
    createSendingDomain: (name: string, tenantId: string) =>
      request<PostShibaSendingDomain>('POST', `${team}/sending_domains`, {
        sending_domain: { name, tenant_id: tenantId },
      }),
    getSendingDomain: (id: string) =>
      request<PostShibaSendingDomain>('GET', `/api/v1/sending_domains/${encodeURIComponent(id)}`),
    /** Runs a DNS check now; a miss rechecks at 30s, 2m and 5m. */
    verifySendingDomain: (id: string) =>
      request<PostShibaSendingDomain>('POST', `/api/v1/sending_domains/${encodeURIComponent(id)}/verify`),
    /** Only the new tenant's SMTP credentials can send from it afterwards; its inboxes move with it. */
    moveSendingDomain: (id: string, tenantId: string) =>
      request<PostShibaSendingDomain>('POST', `/api/v1/sending_domains/${encodeURIComponent(id)}/move`, {
        sending_domain: { tenant_id: tenantId },
      }),
    /** Live inboxes block this; disable them first. */
    deleteSendingDomain: (id: string) =>
      request<unknown>('DELETE', `/api/v1/sending_domains/${encodeURIComponent(id)}`),

    /** The host must be under a verified sending domain and must not already have MX. */
    createInbox: (input: CreateInboxInput) =>
      request<PostShibaInbox>('POST', `${team}/inboxes`, {
        inbox: { ...input, webhook_format: 'json' },
      }),
    getInbox: (id: string) => request<PostShibaInbox>('GET', `/api/v1/inboxes/${encodeURIComponent(id)}`),
    /** Queues an MX check. */
    verifyInbox: (id: string) =>
      request<PostShibaInbox>('POST', `/api/v1/inboxes/${encodeURIComponent(id)}/verify`),
    /** Delivery-event endpoint scoped to one tenant. The response carries the signing secret (create only). */
    createWebhookEndpoint: (url: string, tenantId: string) =>
      request<{ id: string; url: string; secret?: string; tenant_id: string | null; event_types: string[] }>(
        'POST',
        `${team}/webhook_endpoints`,
        { webhook_endpoint: { url, tenant_id: tenantId } },
      ),
    deleteWebhookEndpoint: (id: string) =>
      request<unknown>('DELETE', `/api/v1/webhook_endpoints/${encodeURIComponent(id)}`),
    /** Alive inbound messages for an inbox, newest first (capped at 200 by PostShiba). */
    listInboundMessages: (inboxId: string) =>
      request<Array<Record<string, unknown>>>('GET', `/api/v1/inboxes/${encodeURIComponent(inboxId)}/inbound_messages`),
    /** One alive message with attachment bytes (content_base64); the bytes are null once a webhook delivery succeeded. */
    getInboundMessage: (inboxId: string, id: string) =>
      request<Record<string, unknown>>('GET', `/api/v1/inboxes/${encodeURIComponent(inboxId)}/inbound_messages/${encodeURIComponent(id)}`),
    /** Disables the inbox; the address can be created again. */
    disableInbox: (id: string) =>
      request<PostShibaInbox>('DELETE', `/api/v1/inboxes/${encodeURIComponent(id)}`),
  };
}

export type PostShibaErrorCode =
  | 'invalid_key'
  | 'wrong_team'
  | 'kyc_required'
  | 'payment_required'
  | 'team_suspended'
  | 'operator_hold'
  | 'cluster_not_ready'
  | 'rate_limited'
  | 'rejected'
  | 'postshiba_error';

/** A sentence a user can act on, plus a stable code for the UI and our logs. */
export function describePostShibaError(err: unknown): { status: number; error: string; error_code: PostShibaErrorCode } {
  if (!(err instanceof PostShibaError)) {
    return { status: 502, error: 'Could not reach PostShiba. Try again in a minute.', error_code: 'postshiba_error' };
  }
  if (err.status === 401) {
    return { status: 400, error: 'PostShiba rejected this API key. Check it was copied in full and has not been revoked.', error_code: 'invalid_key' };
  }
  switch (err.code) {
    case 'kyc_required':
      return { status: 400, error: 'Your PostShiba team is waiting for KYC approval. Until PostShiba approves it, it can only send to your own team addresses.', error_code: 'kyc_required' };
    case 'payment_required':
      return { status: 400, error: 'PostShiba needs a card on file for this team.', error_code: 'payment_required' };
    case 'team_suspended':
      return { status: 400, error: 'Your PostShiba team is suspended. Contact PostShiba support.', error_code: 'team_suspended' };
    case 'operator_hold':
      return { status: 400, error: 'PostShiba has paused this organization\'s tenant. Contact PostShiba support.', error_code: 'operator_hold' };
    case 'cluster_not_ready':
      return { status: 400, error: 'That cluster cannot send yet. Finish setting it up in PostShiba, then try again.', error_code: 'cluster_not_ready' };
    case 'rate_limited':
      return { status: 429, error: 'PostShiba is rate limiting setup calls (60 an hour per API key). Try again shortly.', error_code: 'rate_limited' };
  }
  if (err.status === 429) {
    return { status: 429, error: 'PostShiba is rate limiting setup calls (60 an hour per API key). Try again shortly.', error_code: 'rate_limited' };
  }
  if (err.status === 422) {
    return { status: 400, error: `PostShiba refused this: ${err.message}`, error_code: 'rejected' };
  }
  // A bare 403/404 (no error code) is a token used against another team's id.
  if ((err.status === 403 || err.status === 404) && !err.code) {
    return { status: 400, error: 'This API key does not belong to the PostShiba team id you entered.', error_code: 'wrong_team' };
  }
  return { status: 502, error: `PostShiba returned an error: ${err.message}`, error_code: 'postshiba_error' };
}
