/**
 * Azure Resource Management SDK
 *
 * Lightweight wrapper around Azure REST API for provisioning VMs,
 * public IPs, NICs, and VNets for cold email infrastructure.
 * Uses fetch() directly — no heavy npm SDK dependencies.
 */

import {
  AzureAPIError,
  azureGet,
  azurePut,
  azureDelete,
  pollAsyncOperation,
  waitForDeletion,
} from './azure-helpers.ts';

export { AzureAPIError };

// ============================================================================
// Types
// ============================================================================

export interface AzureCredentials {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  subscriptionId: string;
}

export interface AzureToken {
  access_token: string;
  expires_in: number;
  token_type: string;
}

export interface VMConfig {
  vmName: string;
  region: string;
  resourceGroup: string;
  vmSize?: string;         // default: Standard_B1s
  adminUsername?: string;   // default: acaadmin
  adminPassword: string;
  cloudInitScript: string; // base64-encoded cloud-init
  subnetId: string;
  nicId: string;
}

export interface PublicIPResult {
  id: string;              // Azure resource ID
  ipAddress: string;       // Allocated IP
  name: string;
}

export interface VMResult {
  id: string;
  name: string;
  provisioningState: string;
}

export interface SubscriptionInfo {
  subscriptionId: string;
  displayName: string;
  state: string;
  tenantId: string;
}

export interface AzureError {
  code: string;
  message: string;
  status: number;
}

// ============================================================================
// Constants
// ============================================================================

const AZURE_MGMT_URL = 'https://management.azure.com';
const AZURE_LOGIN_URL = 'https://login.microsoftonline.com';
const API_VERSION_COMPUTE = '2024-07-01';
const API_VERSION_NETWORK = '2024-05-01';
const API_VERSION_RESOURCES = '2024-03-01';

// ============================================================================
// Authentication
// ============================================================================

/**
 * Get an OAuth2 access token for Azure Resource Management using client credentials.
 */
export async function getAzureToken(
  tenantId: string,
  clientId: string,
  clientSecret: string
): Promise<string> {
  const tokenUrl = `${AZURE_LOGIN_URL}/${tenantId}/oauth2/v2.0/token`;

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope: `${AZURE_MGMT_URL}/.default`,
  });

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new AzureAPIError('AUTH_FAILED', `Failed to get Azure token: ${error}`, res.status);
  }

  const data: AzureToken = await res.json();
  return data.access_token;
}

// ============================================================================
// Subscription
// ============================================================================

/**
 * Validate Azure subscription access by fetching subscription details.
 */
export async function getSubscription(
  token: string,
  subscriptionId: string
): Promise<SubscriptionInfo> {
  const url = `${AZURE_MGMT_URL}/subscriptions/${subscriptionId}?api-version=${API_VERSION_RESOURCES}`;
  const data = await azureGet(token, url);
  return {
    subscriptionId: data.subscriptionId,
    displayName: data.displayName,
    state: data.state,
    tenantId: data.tenantId,
  };
}

/**
 * List available regions for the subscription.
 */
export async function listLocations(
  token: string,
  subscriptionId: string
): Promise<Array<{ name: string; displayName: string }>> {
  const url = `${AZURE_MGMT_URL}/subscriptions/${subscriptionId}/locations?api-version=${API_VERSION_RESOURCES}`;
  const data = await azureGet(token, url);
  return (data.value || []).map((loc: Record<string, string>) => ({
    name: loc.name,
    displayName: loc.displayName,
  }));
}

// ============================================================================
// Resource Group
// ============================================================================

/**
 * Create or update a resource group.
 * Returns the actual RG name used (may be region-suffixed if the base name exists in a different region).
 */
export async function ensureResourceGroup(
  token: string,
  subscriptionId: string,
  name: string,
  region: string
): Promise<string> {
  const body = { location: region, tags: { managed_by: 'aca', purpose: 'email-infrastructure' } };
  const url = `${AZURE_MGMT_URL}/subscriptions/${subscriptionId}/resourcegroups/${name}?api-version=${API_VERSION_RESOURCES}`;
  try {
    await azurePut(token, url, body);
    return name;
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('InvalidResourceGroupLocation')) {
      // RG exists in a different region — use a region-suffixed name
      const regionName = `${name}-${region}`;
      const regionUrl = `${AZURE_MGMT_URL}/subscriptions/${subscriptionId}/resourcegroups/${regionName}?api-version=${API_VERSION_RESOURCES}`;
      await azurePut(token, regionUrl, body);
      return regionName;
    }
    throw err;
  }
}

// ============================================================================
// Networking
// ============================================================================

/**
 * Create or update a Virtual Network with a default subnet.
 */
export async function ensureVNet(
  token: string,
  subscriptionId: string,
  resourceGroup: string,
  region: string,
  vnetName: string = 'aca-email-vnet'
): Promise<{ vnetId: string; subnetId: string }> {
  const url = `${AZURE_MGMT_URL}/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Network/virtualNetworks/${vnetName}?api-version=${API_VERSION_NETWORK}`;

  const data = await azurePut(token, url, {
    location: region,
    properties: {
      addressSpace: { addressPrefixes: ['10.0.0.0/16'] },
      subnets: [{
        name: 'default',
        properties: { addressPrefix: '10.0.0.0/24' },
      }],
    },
    tags: { managed_by: 'aca' },
  });

  const subnetId = data.properties?.subnets?.[0]?.id ||
    `${AZURE_MGMT_URL}/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Network/virtualNetworks/${vnetName}/subnets/default`;

  return { vnetId: data.id, subnetId };
}

/**
 * Create a static public IP address.
 */
export async function createPublicIP(
  token: string,
  subscriptionId: string,
  resourceGroup: string,
  region: string,
  name: string
): Promise<PublicIPResult> {
  const url = `${AZURE_MGMT_URL}/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Network/publicIPAddresses/${name}?api-version=${API_VERSION_NETWORK}`;

  const data = await azurePut(token, url, {
    location: region,
    sku: { name: 'Standard' },
    properties: {
      publicIPAllocationMethod: 'Static',
      publicIPAddressVersion: 'IPv4',
    },
    tags: { managed_by: 'aca' },
  });

  // IP may not be allocated immediately — poll until available
  let ipAddress = data.properties?.ipAddress;
  if (!ipAddress) {
    ipAddress = await pollForIP(token, url);
  }

  return { id: data.id, ipAddress, name };
}

/**
 * Create a Network Security Group allowing SMTP (25, 587), IMAP (993), HTTP (80, 443), and SSH (22).
 */
export async function ensureNSG(
  token: string,
  subscriptionId: string,
  resourceGroup: string,
  region: string,
  nsgName: string = 'aca-email-nsg'
): Promise<string> {
  const url = `${AZURE_MGMT_URL}/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Network/networkSecurityGroups/${nsgName}?api-version=${API_VERSION_NETWORK}`;

  const data = await azurePut(token, url, {
    location: region,
    properties: {
      securityRules: [
        { name: 'Allow-SSH', properties: { protocol: 'Tcp', sourcePortRange: '*', destinationPortRange: '22', sourceAddressPrefix: '*', destinationAddressPrefix: '*', access: 'Allow', priority: 100, direction: 'Inbound' } },
        { name: 'Allow-SMTP-25', properties: { protocol: 'Tcp', sourcePortRange: '*', destinationPortRange: '25', sourceAddressPrefix: '*', destinationAddressPrefix: '*', access: 'Allow', priority: 110, direction: 'Inbound' } },
        { name: 'Allow-SMTP-587', properties: { protocol: 'Tcp', sourcePortRange: '*', destinationPortRange: '587', sourceAddressPrefix: '*', destinationAddressPrefix: '*', access: 'Allow', priority: 120, direction: 'Inbound' } },
        { name: 'Allow-IMAP-993', properties: { protocol: 'Tcp', sourcePortRange: '*', destinationPortRange: '993', sourceAddressPrefix: '*', destinationAddressPrefix: '*', access: 'Allow', priority: 130, direction: 'Inbound' } },
        { name: 'Allow-HTTP', properties: { protocol: 'Tcp', sourcePortRange: '*', destinationPortRange: '80', sourceAddressPrefix: '*', destinationAddressPrefix: '*', access: 'Allow', priority: 140, direction: 'Inbound' } },
        { name: 'Allow-HTTPS', properties: { protocol: 'Tcp', sourcePortRange: '*', destinationPortRange: '443', sourceAddressPrefix: '*', destinationAddressPrefix: '*', access: 'Allow', priority: 150, direction: 'Inbound' } },
      ],
    },
    tags: { managed_by: 'aca' },
  });

  return data.id;
}

/**
 * Create a Network Interface Card (NIC) with a public IP and NSG.
 */
export async function createNIC(
  token: string,
  subscriptionId: string,
  resourceGroup: string,
  region: string,
  nicName: string,
  subnetId: string,
  publicIpId: string,
  nsgId: string
): Promise<string> {
  const url = `${AZURE_MGMT_URL}/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Network/networkInterfaces/${nicName}?api-version=${API_VERSION_NETWORK}`;

  const data = await azurePut(token, url, {
    location: region,
    properties: {
      ipConfigurations: [{
        name: 'ipconfig1',
        properties: {
          subnet: { id: subnetId },
          publicIPAddress: { id: publicIpId },
          privateIPAllocationMethod: 'Dynamic',
        },
      }],
      networkSecurityGroup: { id: nsgId },
    },
    tags: { managed_by: 'aca' },
  });

  return data.id;
}

// ============================================================================
// Virtual Machine
// ============================================================================

/**
 * Create an Ubuntu VM with cloud-init for Postfix/Dovecot/OpenDKIM.
 */
export async function createVM(
  token: string,
  subscriptionId: string,
  config: VMConfig
): Promise<VMResult> {
  const { vmName, region, resourceGroup, adminPassword, cloudInitScript, nicId } = config;
  const vmSize = config.vmSize || 'Standard_B1s';
  const adminUsername = config.adminUsername || 'acaadmin';

  const url = `${AZURE_MGMT_URL}/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Compute/virtualMachines/${vmName}?api-version=${API_VERSION_COMPUTE}`;

  const data = await azurePut(token, url, {
    location: region,
    properties: {
      hardwareProfile: { vmSize },
      storageProfile: {
        imageReference: {
          publisher: 'Canonical',
          offer: '0001-com-ubuntu-server-jammy',
          sku: '22_04-lts-gen2',
          version: 'latest',
        },
        osDisk: {
          createOption: 'FromImage',
          managedDisk: { storageAccountType: 'Standard_LRS' },
          diskSizeGB: 30,
        },
      },
      osProfile: {
        computerName: vmName,
        adminUsername,
        adminPassword,
        customData: cloudInitScript, // base64 cloud-init
        linuxConfiguration: {
          disablePasswordAuthentication: false,
        },
      },
      networkProfile: {
        networkInterfaces: [{ id: nicId, properties: { primary: true } }],
      },
    },
    tags: { managed_by: 'aca', purpose: 'email-sending' },
  });

  return {
    id: data.id,
    name: data.name,
    provisioningState: data.properties?.provisioningState || 'Creating',
  };
}

/**
 * Get VM provisioning state.
 */
export async function getVMStatus(
  token: string,
  subscriptionId: string,
  resourceGroup: string,
  vmName: string
): Promise<{ provisioningState: string; powerState?: string }> {
  const url = `${AZURE_MGMT_URL}/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Compute/virtualMachines/${vmName}?api-version=${API_VERSION_COMPUTE}&$expand=instanceView`;

  const data = await azureGet(token, url);

  const powerState = data.properties?.instanceView?.statuses
    ?.find((s: Record<string, string>) => s.code?.startsWith('PowerState/'))
    ?.displayStatus;

  return {
    provisioningState: data.properties?.provisioningState || 'Unknown',
    powerState,
  };
}

/**
 * Delete a VM and all associated resources (disk, NIC, public IP).
 */
export async function deleteVMAndResources(
  token: string,
  subscriptionId: string,
  resourceGroup: string,
  vmName: string,
  nicName: string,
  publicIpName: string
): Promise<void> {
  // Delete VM first (async operation)
  const vmUrl = `${AZURE_MGMT_URL}/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Compute/virtualMachines/${vmName}?api-version=${API_VERSION_COMPUTE}`;
  await azureDelete(token, vmUrl);

  // Wait for VM deletion to complete before deleting NIC
  await waitForDeletion(token, vmUrl);

  // Delete NIC
  const nicUrl = `${AZURE_MGMT_URL}/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Network/networkInterfaces/${nicName}?api-version=${API_VERSION_NETWORK}`;
  await azureDelete(token, nicUrl);
  await waitForDeletion(token, nicUrl);

  // Delete public IP
  const ipUrl = `${AZURE_MGMT_URL}/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Network/publicIPAddresses/${publicIpName}?api-version=${API_VERSION_NETWORK}`;
  await azureDelete(token, ipUrl);
}

// ============================================================================
// Reverse DNS
// ============================================================================

/**
 * Convert a domain to a valid Azure domain name label (alphanumeric and hyphens only).
 */
export function azureDomainLabel(domain: string): string {
  return domain.replace(/[^a-z0-9]/gi, '-').toLowerCase();
}

/**
 * Set reverse DNS (PTR record) on an Azure public IP by adding dnsSettings.
 */
export async function setReverseDns(
  token: string,
  subscriptionId: string,
  resourceGroup: string,
  region: string,
  ipName: string,
  fqdn: string,
  domainLabel: string,
): Promise<void> {
  const url = `${AZURE_MGMT_URL}/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Network/publicIPAddresses/${ipName}?api-version=${API_VERSION_NETWORK}`;

  // GET current public IP config
  const current = await azureGet(token, url);

  // Merge dnsSettings into existing properties
  const properties = (current.properties || {}) as Record<string, unknown>;
  properties.dnsSettings = {
    ...(properties.dnsSettings as Record<string, unknown> || {}),
    reverseFqdn: fqdn,
    domainNameLabel: domainLabel,
  };

  await azurePut(token, url, {
    location: region,
    properties,
    sku: current.sku,
    tags: current.tags,
  });
}

// ============================================================================
// IP Rotation
// ============================================================================

/**
 * Rotate a VM's public IP: create new IP, swap on NIC, delete old IP.
 * Returns the new public IP address.
 */
export async function rotatePublicIP(
  token: string,
  subscriptionId: string,
  resourceGroup: string,
  region: string,
  nicName: string,
  oldIpName: string,
  newIpName: string,
  reverseDnsFqdn?: string
): Promise<PublicIPResult> {
  const nicUrl = `${AZURE_MGMT_URL}/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Network/networkInterfaces/${nicName}?api-version=${API_VERSION_NETWORK}`;
  const oldIpUrl = `${AZURE_MGMT_URL}/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Network/publicIPAddresses/${oldIpName}?api-version=${API_VERSION_NETWORK}`;

  // 1. Dissociate old IP from NIC (removes the public IP reference, keeps private IP)
  const nic = await azureGet(token, nicUrl) as Record<string, any>;
  if (nic.properties?.ipConfigurations?.[0]?.properties) {
    delete nic.properties.ipConfigurations[0].properties.publicIPAddress;
  }
  await azurePut(token, nicUrl, {
    location: region,
    properties: nic.properties,
    tags: nic.tags,
  });

  // 2. Delete old public IP (now unattached, frees quota)
  await azureDelete(token, oldIpUrl);

  // 3. Create new public IP (within quota since old one is freed)
  const newIp = await createPublicIP(token, subscriptionId, resourceGroup, region, newIpName);

  // 4. Attach new IP to NIC
  const nicRefresh = await azureGet(token, nicUrl) as Record<string, any>;
  if (nicRefresh.properties?.ipConfigurations?.[0]?.properties) {
    nicRefresh.properties.ipConfigurations[0].properties.publicIPAddress = { id: newIp.id };
  }
  await azurePut(token, nicUrl, {
    location: region,
    properties: nicRefresh.properties,
    tags: nicRefresh.tags,
  });

  // 5. Set reverse DNS on new IP if requested
  if (reverseDnsFqdn) {
    await setReverseDns(
      token,
      subscriptionId,
      resourceGroup,
      region,
      newIpName,
      reverseDnsFqdn,
      azureDomainLabel(reverseDnsFqdn),
    );
  }

  return newIp;
}

// ============================================================================
// Run Command (SSH alternative via Azure API)
// ============================================================================

/**
 * Execute a shell command on a VM via Azure Run Command API.
 * This avoids SSH — uses Azure's agent on the VM.
 */
/**
 * Extract the stdout text from an Azure Run Command result.
 * Handles both raw JSON objects and stringified results from pollAsyncOperation.
 */
/**
 * Extract stdout from an Azure Run Command result.
 *
 * Azure Run Command responses come in various shapes:
 *   Sync 200:  { properties: { output: [{ message: "stdout\n[stderr]\n..." }] } }
 *   Async 202 (pollAsyncOperation stringifies properties):
 *              '{"output":{"value":[{"code":"...","message":"Enable succeeded: \n[stdout]\n...\n[stderr]\n..."}]}}'
 */
function extractRunCommandOutput(data: unknown): string {
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { return data as string; }
  }
  if (!data || typeof data !== 'object') {
    return typeof data === 'string' ? data : JSON.stringify(data);
  }

  const obj = data as Record<string, unknown>;
  const props = (obj.properties || obj) as Record<string, unknown>;
  const output = props.output;

  // Shape 1: output is array — sync response
  if (Array.isArray(output)) {
    const msg = (output[0] as Record<string, unknown>)?.message;
    if (typeof msg === 'string') return extractStdout(msg);
  }

  // Shape 2: output is object with value array — async response
  if (output && typeof output === 'object' && !Array.isArray(output)) {
    const valueArr = (output as Record<string, unknown>).value;
    if (Array.isArray(valueArr)) {
      const msg = (valueArr[0] as Record<string, unknown>)?.message;
      if (typeof msg === 'string') return extractStdout(msg);
    }
  }

  if (typeof output === 'string') return output;
  return JSON.stringify(data);
}

/** Extract the [stdout] section from Azure RunCommand message format. */
function extractStdout(message: string): string {
  // Azure wraps output as: "Enable succeeded: \n[stdout]\n<actual output>\n[stderr]\n<errors>"
  const stdoutMatch = message.match(/\[stdout\]\n([\s\S]*?)(?:\n\[stderr\]|$)/);
  if (stdoutMatch) return stdoutMatch[1].trim();
  // Fallback: return the whole message
  return message;
}

export async function runCommandOnVM(
  token: string,
  subscriptionId: string,
  resourceGroup: string,
  vmName: string,
  script: string[],
  maxRetries = 3
): Promise<string> {
  const url = `${AZURE_MGMT_URL}/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Compute/virtualMachines/${vmName}/runCommand?api-version=${API_VERSION_COMPUTE}`;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        commandId: 'RunShellScript',
        script,
      }),
    });

    // Azure returns 409 Conflict when another RunCommand is already executing
    if (res.status === 409 && attempt < maxRetries) {
      console.log(`[Azure] RunCommand conflict on ${vmName}, retrying in 15s (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise((r) => setTimeout(r, 15000));
      continue;
    }

    // Run command returns 202 with async operation (202 is res.ok, so check explicitly)
    if (res.status === 202) {
      const asyncUrl = res.headers.get('Azure-AsyncOperation') || res.headers.get('Location');
      if (asyncUrl) {
        const asyncResult = await pollAsyncOperation(token, asyncUrl);
        return extractRunCommandOutput(asyncResult);
      }
    }

    if (!res.ok) {
      const error = await res.text();
      throw new AzureAPIError('RUN_COMMAND_FAILED', `Run command failed: ${error}`, res.status);
    }

    const text = await res.text();
    if (!text) {
      return '';
    }
    const data = JSON.parse(text);
    return extractRunCommandOutput(data);
  }

  throw new AzureAPIError('RUN_COMMAND_FAILED', 'Run command failed after max retries (409 Conflict)', 409);
}

// ============================================================================
// SKU Discovery
// ============================================================================

interface AzureSku {
  name: string;
  resourceType: string;
  locations: string[];
  restrictions: Array<{ type: string; values: string[]; reasonCode: string }>;
  capabilities: Array<{ name: string; value: string }>;
}

/**
 * Query Azure for VM sizes that are actually available in a region.
 * Filters for Gen2 x64, 1-2 vCPUs, no capacity restrictions.
 * Returns SKU names sorted cheapest-first (B-series prioritized).
 */
export async function listAvailableVmSizes(
  token: string,
  subscriptionId: string,
  region: string
): Promise<string[]> {
  const url = `${AZURE_MGMT_URL}/subscriptions/${subscriptionId}/providers/Microsoft.Compute/skus?api-version=${API_VERSION_COMPUTE}&$filter=location eq '${region}'`;
  const data = await azureGet(token, url);
  const skus = (data.value || []) as AzureSku[];

  const eligible: Array<{ name: string; vCPUs: number; memoryGB: number; isBSeries: boolean }> = [];

  for (const sku of skus) {
    if (sku.resourceType !== 'virtualMachines') continue;

    // Skip if restricted in this region
    const restricted = (sku.restrictions || []).some(
      (r) => r.type === 'Location' && r.values?.some((v) => v.toLowerCase() === region.toLowerCase())
    );
    if (restricted) continue;

    // Also skip Zone-restricted SKUs (NotAvailableForSubscription)
    const subRestricted = (sku.restrictions || []).some(
      (r) => r.reasonCode === 'NotAvailableForSubscription'
    );
    if (subRestricted) continue;

    const caps = Object.fromEntries((sku.capabilities || []).map((c) => [c.name, c.value]));

    // Must support Gen2 (HyperVGenerations contains 'V2')
    const hyperV = caps.HyperVGenerations || '';
    if (!hyperV.includes('V2')) continue;

    // Must be x64
    const arch = caps.CpuArchitectureType || '';
    if (arch && arch !== 'x64') continue;

    // 1-2 vCPUs only (email server doesn't need more)
    const vCPUs = parseInt(caps.vCPUs || '0', 10);
    if (vCPUs < 1 || vCPUs > 2) continue;

    const memoryGB = parseFloat(caps.MemoryGB || '0');

    eligible.push({
      name: sku.name,
      vCPUs,
      memoryGB,
      isBSeries: sku.name.startsWith('Standard_B'),
    });
  }

  // Sort: B-series first (cheapest burstable), then by vCPUs, then memory
  eligible.sort((a, b) => {
    if (a.isBSeries !== b.isBSeries) return a.isBSeries ? -1 : 1;
    if (a.vCPUs !== b.vCPUs) return a.vCPUs - b.vCPUs;
    return a.memoryGB - b.memoryGB;
  });

  return eligible.map((s) => s.name);
}

// ============================================================================
// Helpers (VM-specific — shared helpers are in azure-helpers.ts)
// ============================================================================

async function pollForIP(token: string, url: string, maxAttempts = 30): Promise<string> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const data = await azureGet(token, url);
    if (data.properties && (data.properties as Record<string, string>).ipAddress) {
      return (data.properties as Record<string, string>).ipAddress;
    }
  }
  throw new AzureAPIError('TIMEOUT', 'Timed out waiting for IP allocation', 408);
}
