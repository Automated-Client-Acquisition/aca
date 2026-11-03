/**
 * Azure Communication Services (ACS) Client
 *
 * Provisions ACS email infrastructure via Azure REST API.
 * Each domain gets its own isolated resource group with:
 *   - Email Communication Service
 *   - Communication Service
 *   - Custom domain with SPF/DKIM/DKIM2 verification
 *   - Sender addresses
 *   - Entra ID app registration for SMTP auth
 *   - EventGrid subscription for inbound email webhooks
 *
 * ACS sends through Microsoft's Exchange Online transport layer —
 * the same IPs used by Fortune 500 companies.
 */

import {
  AzureAPIError,
  azureGet,
  azurePut,
  azurePatch,
  azurePost,
  azureDelete,
  pollAsyncOperation,
} from './azure-helpers.ts';

// ============================================================================
// Types
// ============================================================================

export interface ACSVerificationRecord {
  type: 'Domain' | 'SPF' | 'DKIM' | 'DKIM2';
  name: string;
  value: string;
  recordType: 'TXT' | 'CNAME';
  ttl: number;
  status: 'NotStarted' | 'VerificationRequested' | 'VerificationInProgress' | 'VerificationFailed' | 'Verified';
}

export interface ACSSenderAddress {
  username: string;
  displayName: string;
  email: string;
}

export interface ACSProvisionResult {
  resourceGroup: string;
  emailServiceName: string;
  emailServiceResourceId: string;
  commServiceName: string;
  commServiceResourceId: string;
  domainResourceId: string;
  verificationRecords: ACSVerificationRecord[];
  entraAppId: string;
  entraAppObjectId: string;
  entraAppSecret: string;
  entraSpId: string;
  smtpUsername: string;
}

export interface DnsRecord {
  type: 'A' | 'MX' | 'TXT' | 'CNAME';
  name: string;
  value: string;
  priority?: number;
  ttl: number;
  verified: boolean;
  description?: string;
  conflict?: string | null;
}

// ============================================================================
// Constants
// ============================================================================

const AZURE_MGMT_URL = 'https://management.azure.com';
const AZURE_LOGIN_URL = 'https://login.microsoftonline.com';
const GRAPH_URL = 'https://graph.microsoft.com/v1.0';
const ACS_API_VERSION = '2023-04-01';
const EVENTGRID_API_VERSION = '2024-06-01-preview';
const RESOURCES_API_VERSION = '2024-03-01';

// ============================================================================
// Authentication
// ============================================================================

/**
 * Get an OAuth2 token for Microsoft Graph API (Entra ID operations).
 */
export async function getGraphToken(
  tenantId: string,
  clientId: string,
  clientSecret: string
): Promise<string> {
  const tokenUrl = `${AZURE_LOGIN_URL}/${tenantId}/oauth2/v2.0/token`;

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://graph.microsoft.com/.default',
  });

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new AzureAPIError('GRAPH_AUTH_FAILED', `Failed to get Graph token: ${error}`, res.status);
  }

  const data = await res.json();
  return data.access_token;
}

// ============================================================================
// Resource Group
// ============================================================================

/**
 * Create a per-domain resource group for ACS isolation.
 * Naming: acs-{domain-slug} (e.g., acs-example-com)
 */
export async function ensureAcsDomainResourceGroup(
  token: string,
  subscriptionId: string,
  domain: string,
  region: string
): Promise<string> {
  const rgName = `acs-${domain.replace(/[^a-z0-9]/gi, '-').toLowerCase()}`;
  const url = `${AZURE_MGMT_URL}/subscriptions/${subscriptionId}/resourcegroups/${rgName}?api-version=${RESOURCES_API_VERSION}`;

  await azurePut(token, url, {
    location: region,
    tags: {
      managed_by: 'aca',
      purpose: 'acs-email',
      domain: domain,
    },
  });

  return rgName;
}

// ============================================================================
// Email Communication Service
// ============================================================================

/**
 * Create an Email Communication Service resource.
 * This is the parent resource that holds email domains.
 * Polls until provisioningState = Succeeded before returning.
 */
export async function createEmailService(
  token: string,
  subscriptionId: string,
  resourceGroup: string,
  region: string,
  name: string
): Promise<{ resourceId: string }> {
  const url = `${AZURE_MGMT_URL}/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Communication/emailServices/${name}?api-version=${ACS_API_VERSION}`;

  const data = await azurePut(token, url, {
    location: 'global', // Email services are always global
    properties: {
      dataLocation: region === 'eastus' ? 'United States' : region === 'westeurope' ? 'Europe' : 'United States',
    },
    tags: { managed_by: 'aca' },
  });

  // Azure provisions Email Services asynchronously — poll until Succeeded
  // before callers try to add child resources (domains).
  const resourceId = data.id as string;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const status = await azureGet(token, url);
    const state = (status.properties as Record<string, unknown>)?.provisioningState as string;
    if (state === 'Succeeded') break;
    if (state === 'Failed' || state === 'Canceled') {
      throw new AzureAPIError('EMAIL_SERVICE_PROVISION_FAILED', `Email Communication Service provisioning ${state}`, 500);
    }
    // 'Creating' or 'Accepted' — keep polling
  }

  return { resourceId };
}

// ============================================================================
// Communication Service
// ============================================================================

/**
 * Create a Communication Service resource.
 * This provides the SMTP endpoint and is linked to email domains.
 * Polls until provisioningState = Succeeded before returning.
 */
export async function createCommunicationService(
  token: string,
  subscriptionId: string,
  resourceGroup: string,
  region: string,
  name: string
): Promise<{ resourceId: string }> {
  const url = `${AZURE_MGMT_URL}/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Communication/communicationServices/${name}?api-version=${ACS_API_VERSION}`;

  const data = await azurePut(token, url, {
    location: 'global', // Communication Services are always global
    properties: {
      dataLocation: region === 'eastus' ? 'United States' : region === 'westeurope' ? 'Europe' : 'United States',
    },
    tags: { managed_by: 'aca' },
  });

  const resourceId = data.id as string;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const status = await azureGet(token, url);
    const state = (status.properties as Record<string, unknown>)?.provisioningState as string;
    if (state === 'Succeeded') break;
    if (state === 'Failed' || state === 'Canceled') {
      throw new AzureAPIError('COMM_SERVICE_PROVISION_FAILED', `Communication Service provisioning ${state}`, 500);
    }
  }

  return { resourceId };
}

/**
 * Link a verified email domain to a Communication Service.
 * Required before sending email from this domain.
 */
export async function linkDomainToCommunicationService(
  token: string,
  subscriptionId: string,
  resourceGroup: string,
  commServiceName: string,
  domainResourceId: string
): Promise<void> {
  const url = `${AZURE_MGMT_URL}/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Communication/communicationServices/${commServiceName}?api-version=${ACS_API_VERSION}`;

  // GET current to preserve existing properties
  const current = await azureGet(token, url);
  const properties = current.properties as Record<string, unknown> || {};
  const existingDomains = (properties.linkedDomains || []) as string[];

  if (!existingDomains.includes(domainResourceId)) {
    existingDomains.push(domainResourceId);
  }

  await azurePatch(token, url, {
    properties: {
      ...properties,
      linkedDomains: existingDomains,
    },
  });
}

// ============================================================================
// Custom Domain
// ============================================================================

/**
 * Add a custom domain to an Email Communication Service.
 * The domain must be verified via DNS records before emails can be sent.
 */
export async function addCustomDomain(
  token: string,
  subscriptionId: string,
  resourceGroup: string,
  emailServiceName: string,
  domain: string
): Promise<{ resourceId: string }> {
  const url = `${AZURE_MGMT_URL}/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Communication/emailServices/${emailServiceName}/domains/${domain}?api-version=${ACS_API_VERSION}`;

  const data = await azurePut(token, url, {
    location: 'global',
    properties: {
      domainManagement: 'CustomerManaged',
      userEngagementTracking: 'Disabled',
    },
  });

  return { resourceId: data.id as string };
}

/**
 * Get verification records for a custom domain.
 * These are the DNS records the tenant must add to prove domain ownership.
 */
export async function getVerificationRecords(
  token: string,
  subscriptionId: string,
  resourceGroup: string,
  emailServiceName: string,
  domain: string
): Promise<ACSVerificationRecord[]> {
  const url = `${AZURE_MGMT_URL}/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Communication/emailServices/${emailServiceName}/domains/${domain}?api-version=${ACS_API_VERSION}`;

  const data = await azureGet(token, url);
  const properties = data.properties as Record<string, unknown> || {};
  const verificationRecords = properties.verificationRecords as Record<string, unknown> || {};
  const verificationStates = properties.verificationStates as Record<string, unknown> || {};

  const records: ACSVerificationRecord[] = [];

  // Domain ownership verification (TXT record)
  const domainRecord = verificationRecords.Domain as Record<string, unknown>;
  if (domainRecord) {
    const domainState = verificationStates.Domain as Record<string, unknown> || {};
    records.push({
      type: 'Domain',
      name: domainRecord.name as string || domain,
      value: domainRecord.value as string || '',
      recordType: (domainRecord.type as 'TXT' | 'CNAME') || 'TXT',
      ttl: (domainRecord.ttl as number) || 3600,
      status: (domainState.status as ACSVerificationRecord['status']) || 'NotStarted',
    });
  }

  // SPF verification (TXT record)
  const spfRecord = verificationRecords.SPF as Record<string, unknown>;
  if (spfRecord) {
    const spfState = verificationStates.SPF as Record<string, unknown> || {};
    records.push({
      type: 'SPF',
      name: spfRecord.name as string || domain,
      value: spfRecord.value as string || '',
      recordType: (spfRecord.type as 'TXT' | 'CNAME') || 'TXT',
      ttl: (spfRecord.ttl as number) || 3600,
      status: (spfState.status as ACSVerificationRecord['status']) || 'NotStarted',
    });
  }

  // DKIM verification (CNAME record)
  const dkimRecord = verificationRecords.DKIM as Record<string, unknown>;
  if (dkimRecord) {
    const dkimState = verificationStates.DKIM as Record<string, unknown> || {};
    records.push({
      type: 'DKIM',
      name: dkimRecord.name as string || `selector1-${domain.replace(/\./g, '-')}._domainkey`,
      value: dkimRecord.value as string || '',
      recordType: (dkimRecord.type as 'TXT' | 'CNAME') || 'CNAME',
      ttl: (dkimRecord.ttl as number) || 3600,
      status: (dkimState.status as ACSVerificationRecord['status']) || 'NotStarted',
    });
  }

  // DKIM2 verification (CNAME record)
  const dkim2Record = verificationRecords.DKIM2 as Record<string, unknown>;
  if (dkim2Record) {
    const dkim2State = verificationStates.DKIM2 as Record<string, unknown> || {};
    records.push({
      type: 'DKIM2',
      name: dkim2Record.name as string || `selector2-${domain.replace(/\./g, '-')}._domainkey`,
      value: dkim2Record.value as string || '',
      recordType: (dkim2Record.type as 'TXT' | 'CNAME') || 'CNAME',
      ttl: (dkim2Record.ttl as number) || 3600,
      status: (dkim2State.status as ACSVerificationRecord['status']) || 'NotStarted',
    });
  }

  return records;
}

/**
 * Initiate DNS verification for a specific record type.
 * ACS will check the DNS records and update verification status.
 */
export async function initiateDomainVerification(
  token: string,
  subscriptionId: string,
  resourceGroup: string,
  emailServiceName: string,
  domain: string,
  verificationType: 'Domain' | 'SPF' | 'DKIM' | 'DKIM2'
): Promise<void> {
  const url = `${AZURE_MGMT_URL}/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Communication/emailServices/${emailServiceName}/domains/${domain}:initiateVerification?api-version=${ACS_API_VERSION}`;

  await azurePost(token, url, {
    verificationType,
  });
}

/**
 * Check verification status for all DNS record types.
 * Returns current status for Domain, SPF, DKIM, DKIM2.
 */
export async function checkAllVerificationStatuses(
  token: string,
  subscriptionId: string,
  resourceGroup: string,
  emailServiceName: string,
  domain: string
): Promise<{
  domain: ACSVerificationRecord['status'];
  spf: ACSVerificationRecord['status'];
  dkim: ACSVerificationRecord['status'];
  dkim2: ACSVerificationRecord['status'];
  allVerified: boolean;
}> {
  const records = await getVerificationRecords(token, subscriptionId, resourceGroup, emailServiceName, domain);

  const statusMap: Record<string, ACSVerificationRecord['status']> = {};
  for (const r of records) {
    statusMap[r.type] = r.status;
  }

  const domainStatus = statusMap.Domain || 'NotStarted';
  const spfStatus = statusMap.SPF || 'NotStarted';
  const dkimStatus = statusMap.DKIM || 'NotStarted';
  const dkim2Status = statusMap.DKIM2 || 'NotStarted';

  return {
    domain: domainStatus,
    spf: spfStatus,
    dkim: dkimStatus,
    dkim2: dkim2Status,
    allVerified: domainStatus === 'Verified' && spfStatus === 'Verified' &&
      dkimStatus === 'Verified' && dkim2Status === 'Verified',
  };
}

// ============================================================================
// Sender Addresses
// ============================================================================

/**
 * Create a sender address (e.g., john@example.com).
 * Must be registered before ACS will accept outbound mail from this address.
 */
export async function createSenderAddress(
  token: string,
  subscriptionId: string,
  resourceGroup: string,
  emailServiceName: string,
  domain: string,
  username: string,
  displayName: string
): Promise<ACSSenderAddress> {
  const url = `${AZURE_MGMT_URL}/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Communication/emailServices/${emailServiceName}/domains/${domain}/senderUsernames/${username}?api-version=${ACS_API_VERSION}`;

  await azurePut(token, url, {
    properties: {
      username: username,
      displayName: displayName,
    },
  });

  return {
    username,
    displayName,
    email: `${username}@${domain}`,
  };
}

/**
 * Delete a sender address.
 */
export async function deleteSenderAddress(
  token: string,
  subscriptionId: string,
  resourceGroup: string,
  emailServiceName: string,
  domain: string,
  username: string
): Promise<void> {
  const url = `${AZURE_MGMT_URL}/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Communication/emailServices/${emailServiceName}/domains/${domain}/senderUsernames/${username}?api-version=${ACS_API_VERSION}`;

  await azureDelete(token, url);
}

/**
 * List all sender addresses for a domain.
 */
export async function listSenderAddresses(
  token: string,
  subscriptionId: string,
  resourceGroup: string,
  emailServiceName: string,
  domain: string
): Promise<ACSSenderAddress[]> {
  const url = `${AZURE_MGMT_URL}/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Communication/emailServices/${emailServiceName}/domains/${domain}/senderUsernames?api-version=${ACS_API_VERSION}`;

  const data = await azureGet(token, url);
  const value = (data.value || []) as Array<Record<string, unknown>>;

  return value.map((item) => {
    const props = item.properties as Record<string, unknown> || {};
    return {
      username: (props.username as string) || (item.name as string) || '',
      displayName: (props.displayName as string) || '',
      email: `${props.username || item.name}@${domain}`,
    };
  });
}

// ============================================================================
// Entra ID App Registration (via Microsoft Graph)
// ============================================================================

/**
 * Register an Entra ID application for ACS SMTP authentication.
 * The app's client credentials are used as SMTP username/password.
 */
export async function registerEntraApp(
  graphToken: string,
  displayName: string
): Promise<{ appId: string; objectId: string }> {
  const res = await fetch(`${GRAPH_URL}/applications`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${graphToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      displayName,
      signInAudience: 'AzureADMyOrg',
    }),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new AzureAPIError('ENTRA_APP_CREATE_FAILED', `Failed to create Entra app: ${error}`, res.status);
  }

  const data = await res.json();
  return {
    appId: data.appId,
    objectId: data.id,
  };
}

/**
 * Create a service principal for the Entra ID app.
 * Required for the app to be usable for authentication.
 * Retries with backoff because Entra app registration replication can take several seconds.
 */
export async function createEntraServicePrincipal(
  graphToken: string,
  appId: string
): Promise<string> {
  const maxAttempts = 12;
  const delayMs = 8000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(`${GRAPH_URL}/servicePrincipals`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${graphToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ appId }),
    });

    if (res.ok) {
      const data = await res.json();
      return data.id; // Service principal object ID
    }

    const errorText = await res.text();

    // Retry on replication lag errors — app registration hasn't propagated yet
    const isReplicationError = res.status === 404
      || errorText.includes('does not exist')
      || errorText.includes('reference-property')
      || errorText.includes('NoBackingApplicationObject')
      || errorText.includes('does not reference a valid application');
    if (attempt < maxAttempts && isReplicationError) {
      console.log(`[ACS] SP create attempt ${attempt}/${maxAttempts} failed (app not yet replicated), retrying in ${delayMs}ms...`);
      await new Promise((r) => setTimeout(r, delayMs));
      continue;
    }

    throw new AzureAPIError('ENTRA_SP_CREATE_FAILED', `Failed to create service principal: ${errorText}`, res.status);
  }

  throw new AzureAPIError('ENTRA_SP_CREATE_FAILED', 'Failed to create service principal after max retries', 500);
}

/**
 * Create a client secret for the Entra ID app.
 * This secret is used as the SMTP password.
 */
export async function createEntraAppSecret(
  graphToken: string,
  appObjectId: string
): Promise<{ secretText: string; expiresAt: string }> {
  const res = await fetch(`${GRAPH_URL}/applications/${appObjectId}/addPassword`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${graphToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      passwordCredential: {
        displayName: 'ACA SMTP credential',
        endDateTime: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000 * 2).toISOString(), // 2 years
      },
    }),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new AzureAPIError('ENTRA_SECRET_CREATE_FAILED', `Failed to create app secret: ${error}`, res.status);
  }

  const data = await res.json();
  return {
    secretText: data.secretText,
    expiresAt: data.endDateTime,
  };
}

/**
 * Delete an Entra ID app registration (cleanup on domain deletion).
 */
export async function deleteEntraApp(
  graphToken: string,
  appObjectId: string
): Promise<void> {
  const res = await fetch(`${GRAPH_URL}/applications/${appObjectId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${graphToken}`,
    },
  });

  // 204 = success, 404 = already deleted
  if (!res.ok && res.status !== 404) {
    const error = await res.text();
    throw new AzureAPIError('ENTRA_APP_DELETE_FAILED', `Failed to delete Entra app: ${error}`, res.status);
  }
}

// ============================================================================
// EventGrid Subscription (Inbound Email)
// ============================================================================

/**
 * Create an EventGrid subscription on the Communication Service resource
 * to receive inbound email events via webhook.
 */
export async function createEventGridSubscription(
  token: string,
  commServiceResourceId: string,
  webhookUrl: string,
  subscriptionName: string
): Promise<string> {
  const url = `${AZURE_MGMT_URL}${commServiceResourceId}/providers/Microsoft.EventGrid/eventSubscriptions/${subscriptionName}?api-version=${EVENTGRID_API_VERSION}`;

  const data = await azurePut(token, url, {
    properties: {
      destination: {
        endpointType: 'WebHook',
        properties: {
          endpointUrl: webhookUrl,
        },
      },
      filter: {
        includedEventTypes: [
          'Microsoft.Communication.EmailReceived',
        ],
      },
      eventDeliverySchema: 'EventGridSchema',
    },
  });

  return data.id as string;
}

/**
 * Delete an EventGrid subscription.
 */
export async function deleteEventGridSubscription(
  token: string,
  subscriptionResourceId: string
): Promise<void> {
  const url = `${AZURE_MGMT_URL}${subscriptionResourceId}?api-version=${EVENTGRID_API_VERSION}`;
  await azureDelete(token, url);
}

// ============================================================================
// Resource Group Cleanup
// ============================================================================

/**
 * Delete an entire resource group (cascades all ACS resources inside).
 * This is the cleanest way to tear down a domain's infrastructure.
 */
export async function deleteAcsResourceGroup(
  token: string,
  subscriptionId: string,
  resourceGroupName: string
): Promise<void> {
  const url = `${AZURE_MGMT_URL}/subscriptions/${subscriptionId}/resourcegroups/${resourceGroupName}?api-version=${RESOURCES_API_VERSION}`;
  await azureDelete(token, url);
}

// ============================================================================
// DNS Record Generation
// ============================================================================

/**
 * Transform ACS verification records into the DnsRecord[] format
 * used by the existing UI and email_sending_domains.dns_records column.
 * Also adds a DMARC record.
 */
export function generateAcsDnsRecords(
  domain: string,
  verificationRecords: ACSVerificationRecord[]
): DnsRecord[] {
  const records: DnsRecord[] = [];

  for (const vr of verificationRecords) {
    records.push({
      type: vr.recordType,
      name: vr.name,
      value: vr.value,
      ttl: vr.ttl || 3600,
      verified: vr.status === 'Verified',
      description: getDnsDescription(vr.type),
    });
  }

  // Add DMARC record (not provided by ACS, must be added manually)
  records.push({
    type: 'TXT',
    name: `_dmarc.${domain}`,
    value: `v=DMARC1; p=quarantine; rua=mailto:dmarc@${domain}`,
    ttl: 3600,
    verified: false,
    description: 'DMARC — email authentication policy (quarantine unauthorized mail)',
  });

  return records;
}

function getDnsDescription(type: ACSVerificationRecord['type']): string {
  switch (type) {
    case 'Domain':
      return 'Domain ownership verification — proves you control this domain';
    case 'SPF':
      return 'SPF — authorizes Azure Communication Services to send email for your domain';
    case 'DKIM':
      return 'DKIM — cryptographic email signature (selector 1)';
    case 'DKIM2':
      return 'DKIM2 — cryptographic email signature (selector 2, for key rotation)';
    default:
      return '';
  }
}

// ============================================================================
// Full Provisioning Orchestrator
// ============================================================================

/**
 * Provision complete ACS email infrastructure for a domain.
 * This is the main orchestration function called during domain provisioning.
 *
 * Steps:
 * 1. Create per-domain resource group
 * 2. Create Email Communication Service
 * 3. Add custom domain
 * 4. Get verification records
 * 5. Create Communication Service
 * 6. Register Entra ID app + service principal + secret
 * 7. Create EventGrid subscription for inbound email
 *
 * Note: Domain linking happens AFTER DNS verification, not during provisioning.
 */
export async function provisionAcsDomain(
  azureToken: string,
  graphToken: string,
  subscriptionId: string,
  tenantId: string,
  domain: string,
  region: string,
  webhookUrl: string
): Promise<ACSProvisionResult> {
  const domainSlug = domain.replace(/[^a-z0-9]/gi, '-').toLowerCase();

  // 1. Create isolated resource group
  console.log(`[ACS] [${domain}] Creating resource group...`);
  const resourceGroup = await ensureAcsDomainResourceGroup(azureToken, subscriptionId, domain, region);

  // 2. Create Email Communication Service
  const emailServiceName = `acs-email-${domainSlug}`;
  console.log(`[ACS] [${domain}] Creating Email Communication Service: ${emailServiceName}`);
  const emailService = await createEmailService(azureToken, subscriptionId, resourceGroup, region, emailServiceName);

  // 3. Add custom domain
  console.log(`[ACS] [${domain}] Adding custom domain...`);
  const domainResult = await addCustomDomain(azureToken, subscriptionId, resourceGroup, emailServiceName, domain);

  // 4. Get verification records (DNS entries tenant must add)
  console.log(`[ACS] [${domain}] Fetching verification records...`);
  const verificationRecords = await getVerificationRecords(azureToken, subscriptionId, resourceGroup, emailServiceName, domain);

  // 5. Create Communication Service (for SMTP endpoint)
  const commServiceName = `acs-comm-${domainSlug}`;
  console.log(`[ACS] [${domain}] Creating Communication Service: ${commServiceName}`);
  const commService = await createCommunicationService(azureToken, subscriptionId, resourceGroup, region, commServiceName);

  // 6. Register Entra ID app for SMTP auth
  const entraAppName = `aca-smtp-${domainSlug}`;
  console.log(`[ACS] [${domain}] Registering Entra ID app: ${entraAppName}`);
  const entraApp = await registerEntraApp(graphToken, entraAppName);

  console.log(`[ACS] [${domain}] Creating service principal...`);
  const spId = await createEntraServicePrincipal(graphToken, entraApp.appId);

  console.log(`[ACS] [${domain}] Creating app secret...`);
  const secret = await createEntraAppSecret(graphToken, entraApp.objectId);

  // SMTP username format: {commServiceName}.{entraAppId}.{tenantId}
  const smtpUsername = `${commServiceName}.${entraApp.appId}.${tenantId}`;

  // 7. Create EventGrid subscription for inbound email
  let eventGridSubId = '';
  if (webhookUrl) {
    try {
      console.log(`[ACS] [${domain}] Creating EventGrid subscription for inbound email...`);
      eventGridSubId = await createEventGridSubscription(
        azureToken,
        commService.resourceId,
        webhookUrl,
        `acs-inbound-${domainSlug}`
      );
    } catch (err) {
      // EventGrid may not be available in all regions — log but don't fail provisioning
      console.warn(`[ACS] [${domain}] EventGrid subscription failed (inbound email won't work):`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`[ACS] [${domain}] Provisioning complete. SMTP username: ${smtpUsername}`);

  return {
    resourceGroup,
    emailServiceName,
    emailServiceResourceId: emailService.resourceId,
    commServiceName,
    commServiceResourceId: commService.resourceId,
    domainResourceId: domainResult.resourceId,
    verificationRecords,
    entraAppId: entraApp.appId,
    entraAppObjectId: entraApp.objectId,
    entraAppSecret: secret.secretText,
    entraSpId: spId,
    smtpUsername,
  };
}

/**
 * Complete domain setup after DNS verification.
 * Links the verified domain to the Communication Service so emails can be sent.
 */
export async function finalizeAcsDomain(
  token: string,
  subscriptionId: string,
  resourceGroup: string,
  commServiceName: string,
  domainResourceId: string
): Promise<void> {
  console.log(`[ACS] Linking domain to Communication Service...`);
  await linkDomainToCommunicationService(token, subscriptionId, resourceGroup, commServiceName, domainResourceId);
}

/**
 * Tear down all ACS infrastructure for a domain.
 * Deletes the resource group (cascading all resources) and the Entra ID app.
 */
export async function teardownAcsDomain(
  azureToken: string,
  graphToken: string,
  subscriptionId: string,
  resourceGroupName: string,
  entraAppObjectId: string | null
): Promise<void> {
  // Delete Entra app first (it's outside the resource group)
  if (entraAppObjectId) {
    try {
      console.log(`[ACS] Deleting Entra app ${entraAppObjectId}...`);
      await deleteEntraApp(graphToken, entraAppObjectId);
    } catch (err) {
      console.warn(`[ACS] Failed to delete Entra app (may not exist):`, err instanceof Error ? err.message : err);
    }
  }

  // Delete resource group (cascades Email Service, Communication Service, domain, sender addresses)
  console.log(`[ACS] Deleting resource group ${resourceGroupName}...`);
  await deleteAcsResourceGroup(azureToken, subscriptionId, resourceGroupName);
}
