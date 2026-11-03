/**
 * Pax8 API client
 *
 * Handles OAuth client-credentials auth + the subset of Pax8 API endpoints
 * needed to provision a brand-new Microsoft 365 tenant + Business Basic
 * (no Teams) license via the self-serve ACA ordering flow.
 *
 * Flow:
 *   1. POST /v1/token                 -> access token (cached per isolate)
 *   2. POST /v1/companies             -> create Pax8 company (end-customer)
 *   3. POST /v1/orders                -> single order that provisions the
 *                                        M365 tenant AND attaches the
 *                                        Business Basic (no Teams) subscription
 *   4. DELETE /v1/subscriptions/{id}  -> cancel on refund / churn
 *
 * Docs:
 *   - https://devx.pax8.com/reference/createaccesstoken
 *   - https://devx.pax8.com/reference/findproductbyproductid
 *   - https://devx.pax8.com/reference/findprovisiondetailsbyproductid
 */

const PAX8_AUTH_URL = 'https://api.pax8.com/v1/token';
const PAX8_AUDIENCE = 'https://api.pax8.com';

interface TokenCache {
  token: string;
  expiresAt: number;
}

let cachedToken: TokenCache | null = null;

function getEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function baseUrl(): string {
  return Deno.env.get('PAX8_API_BASE_URL') ?? 'https://api.pax8.com/v1';
}

export async function getPax8Token(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.token;
  }

  const res = await fetch(PAX8_AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: getEnv('PAX8_CLIENT_ID'),
      client_secret: getEnv('PAX8_CLIENT_SECRET'),
      audience: PAX8_AUDIENCE,
    }),
  });

  if (!res.ok) {
    throw new Error(`Pax8 auth failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  const token = data.access_token as string;
  const expiresIn = (data.expires_in as number) ?? 3600;
  cachedToken = { token, expiresAt: Date.now() + expiresIn * 1000 };
  return token;
}

// deno-lint-ignore no-explicit-any
async function pax8Fetch(path: string, init: RequestInit = {}): Promise<any> {
  const token = await getPax8Token();
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(init.headers ?? {}),
    },
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Pax8 ${init.method ?? 'GET'} ${path} failed: ${res.status} ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

// ============================================================================
// Companies (Pax8 "end customer" records)
// ============================================================================

export interface Pax8CompanyInput {
  companyName: string;
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  stateOrProvince?: string | null;
  postalCode: string;
  country: string; // ISO-2
  phone: string; // full E.164 or formatted string
  website: string; // e.g. "acme.com" (no scheme)
  contactFirstName: string;
  contactLastName: string;
  contactEmail: string;
  externalId?: string; // our tenant_orders.id for traceability
}

export interface Pax8Company {
  id: string;
  name: string;
  // deno-lint-ignore no-explicit-any
  [key: string]: any;
}

/**
 * Finds an existing Pax8 company by the externalId we stamp on creation
 * (our tenant_orders.id). Pax8's List Companies endpoint has NO externalId
 * filter, so we page through and match client-side.
 *
 * This is the idempotency guard for retrying a provision: without it a retry
 * creates a SECOND company (and a second paid tenant) for a customer who has
 * already been provisioned.
 */
export async function findPax8CompanyByExternalId(
  externalId: string,
): Promise<Pax8Company | null> {
  for (let page = 0; page < 20; page++) {
    const res = await pax8Fetch(`/companies?page=${page}&size=200`);
    const content: Pax8Company[] = res?.content ?? [];
    const hit = content.find((c) => c?.externalId === externalId);
    if (hit) return hit;
    const totalPages = res?.page?.totalPages ?? res?.totalPages;
    if (content.length === 0 || (totalPages != null && page + 1 >= totalPages)
      || (totalPages == null && content.length < 200)) return null;
  }
  // An incomplete search cannot safely prove the company doesn't exist.
  throw new Error('Pax8 company search exceeded the pagination limit; reconcile before retrying');
}

export async function getPax8Company(companyId: string): Promise<Pax8Company> {
  return pax8Fetch(`/companies/${encodeURIComponent(companyId)}`);
}

/** Pax8 requires partner-wide unique company names, even across different tenants. */
export function tenantOrderCompanyName(companyName: string, orderId: string): string {
  return `${companyName.trim()} (${orderId})`;
}

export async function updatePax8CompanyAddress(
  company: Pax8Company,
  address: { street: string; street2?: string | null; city: string; stateOrProvince?: string | null; postalCode: string; country: string },
): Promise<Pax8Company> {
  // Pax8 validates name/phone even for an address-only PATCH. Preserve the
  // documented mutable fields from the authoritative existing company.
  if (!company.name || !company.phone) throw new Error('Existing Pax8 company is missing name or phone; reconcile before updating');
  return pax8Fetch(`/companies/${encodeURIComponent(company.id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ name: company.name, phone: company.phone, address,
      website: company.website, externalId: company.externalId,
      billOnBehalfOfEnabled: company.billOnBehalfOfEnabled,
      selfServiceAllowed: company.selfServiceAllowed,
      orderApprovalRequired: company.orderApprovalRequired }),
  });
}

/** Subscriptions attached to a Pax8 company — proof a tenant was actually ordered. */
export async function listPax8Subscriptions(
  companyId: string,
): Promise<Pax8Subscription[]> {
  const res = await pax8Fetch(`/subscriptions?companyId=${companyId}&size=200`);
  return res?.content ?? [];
}

export interface Pax8Subscription {
  id: string;
  companyId?: string;
  productId?: string;
  productName?: string;
  status?: string;
  createdDate?: string;
  // deno-lint-ignore no-explicit-any
  [key: string]: any;
}

export async function createPax8Company(input: Pax8CompanyInput): Promise<Pax8Company> {
  // Pax8 contact types are objects like {"type": "Admin", "primary": true}.
  // Valid type enum values (title-case): "Admin" | "Billing" | "Technical".
  // The bare business domain is used for website; Pax8 accepts it either with
  // or without scheme but the partner UI strips scheme, so we do the same.
  return pax8Fetch('/companies', {
    method: 'POST',
    body: JSON.stringify({
      name: input.companyName,
      address: {
        street: input.addressLine1,
        street2: input.addressLine2 ?? undefined,
        city: input.city,
        stateOrProvince: input.stateOrProvince ?? undefined,
        postalCode: input.postalCode,
        country: input.country,
      },
      phone: input.phone,
      website: input.website,
      billOnBehalfOfEnabled: false,
      selfServiceAllowed: false,
      orderApprovalRequired: false,
      externalId: input.externalId,
      contacts: [
        {
          firstName: input.contactFirstName,
          lastName: input.contactLastName,
          email: input.contactEmail,
          phone: input.phone,
          types: [
            { type: 'Admin', primary: true },
            { type: 'Billing', primary: true },
            { type: 'Technical', primary: true },
          ],
        },
      ],
    }),
  });
}

// ============================================================================
// Orders (provision a net-new M365 tenant + attach subscription)
// ============================================================================

export interface Pax8OrderInput {
  companyId: string;
  productId: string; // Pax8 UUID for M365 Business Basic (no Teams)
  tenantPrefix: string; // e.g. "acme" -> becomes acme.onmicrosoft.com
  adminFirstName: string;
  adminLastName: string;
  adminEmail: string;
  mcaEffectiveDate: string; // YYYY-MM-DD
  orderedByEmail: string; // ACA partner identity
  commitmentTermId?: string; // UUID from product dependencies; required when requiresCommitment=true
}

export interface Pax8OrderLineItem {
  id?: string;
  lineItemNumber?: number;
  productId: string;
  quantity: number;
  billingTerm: string;
  commitmentTerm?: string;
  subscriptionId?: string;
  provisioningDetails?: Array<{ key: string; values: string[] }>;
  // deno-lint-ignore no-explicit-any
  [key: string]: any;
}

export interface Pax8Order {
  id: string;
  status?: string;
  companyId?: string;
  lineItems?: Pax8OrderLineItem[];
  // deno-lint-ignore no-explicit-any
  [key: string]: any;
}

export async function getPax8Order(orderId: string): Promise<Pax8Order> {
  return pax8Fetch(`/orders/${encodeURIComponent(orderId)}`);
}

export async function getPax8Subscription(subscriptionId: string): Promise<Pax8Subscription> {
  return pax8Fetch(`/subscriptions/${encodeURIComponent(subscriptionId)}`);
}

/**
 * Creates a Pax8 order that provisions a new Microsoft 365 tenant and attaches
 * one seat of the configured Business Basic (no Teams) subscription.
 *
 * Shell-template fields (msftContact*, companyRegistrationNumber, GDAP,
 * trialConversion, cancelPolicy) are intentionally omitted because the partner
 * account already has a completed Microsoft Partner Shell — Pax8 populates
 * those from the shell template at order time.
 */
export async function createPax8Order(input: Pax8OrderInput, validateOnly = false): Promise<Pax8Order> {
  const mpnId = getEnv('PAX8_MPN_ID');
  const partnerTenantId = getEnv('PAX8_PARTNER_TENANT_ID');

  // Full set of provisioning details required by Pax8 for this product.
  // The partner shell template does NOT pre-fill these at order time — every
  // order must explicitly send the msftContact*, cancel-policy acknowledgement,
  // GDAP acknowledgement, and trial-conversion acknowledgement.
  const cancelPolicyText =
    'I understand, and acknowledge that I will have a 7 calendar day window to cancel my subscription, or make quantity decrements before I am no longer able to make these changes. Once a subscription is locked, I will be required fulfill my elected commitment term of my subscription.';

  const provisioningDetails = [
    { key: 'msCustExists', values: ['No, the customer does not have a Microsoft account'] },
    { key: 'msDomain', values: [input.tenantPrefix] },
    { key: 'msMPNidval', values: [mpnId] },
    { key: 'msTenantId', values: [partnerTenantId] },
    { key: 'mca2020FirstName', values: [input.adminFirstName] },
    { key: 'mca2020LastName', values: [input.adminLastName] },
    { key: 'mca2020Email', values: [input.adminEmail] },
    { key: 'mca2020EffectiveDate', values: [input.mcaEffectiveDate] },
    { key: 'msftContactFirstName', values: [input.adminFirstName] },
    { key: 'msftContactLastName', values: [input.adminLastName] },
    { key: 'msftContactEmail', values: [input.adminEmail] },
    { key: 'microsoftCancelPolicyAcknowledgement', values: [cancelPolicyText] },
  ];

  const commitmentTermId = input.commitmentTermId
    ?? Deno.env.get('PAX8_M365_BB_COMMITMENT_TERM_ID');
  if (!commitmentTermId) {
    throw new Error(
      'PAX8_M365_BB_COMMITMENT_TERM_ID env var missing and no commitmentTermId passed',
    );
  }

  return pax8Fetch(validateOnly ? '/orders?isMock=true' : '/orders', {
    method: 'POST',
    body: JSON.stringify({
      companyId: input.companyId,
      orderedBy: 'Pax8 Partner',
      orderedByUserEmail: input.orderedByEmail,
      lineItems: [
        {
          lineItemNumber: 1,
          productId: input.productId,
          quantity: 1,
          billingTerm: 'Monthly',
          commitmentTermId,
          provisioningDetails,
        },
      ],
    }),
  });
}

// ============================================================================
// Subscriptions (cancel on refund / churn)
// ============================================================================

export async function cancelPax8Subscription(subscriptionId: string): Promise<void> {
  await pax8Fetch(`/subscriptions/${subscriptionId}`, { method: 'DELETE' });
}
