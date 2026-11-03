/**
 * Azure REST API Helpers
 *
 * Shared HTTP utilities for Azure Resource Management and Graph API calls.
 * Used by both azure-sdk.ts (VM provisioning) and acs-client.ts (ACS provisioning).
 */

// ============================================================================
// Error Class
// ============================================================================

export class AzureAPIError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'AzureAPIError';
    this.code = code;
    this.status = status;
  }
}

// ============================================================================
// HTTP Helpers
// ============================================================================

/** Azure REST responses are free-form JSON whose shape varies per resource and
 * api-version. Typing them Record<string, unknown> meant every field read in
 * azure-sdk.ts was a type error (`unknown` is not a string; `data.properties`
 * has no `.subnets`), which is why that module never type-checked. Callers
 * narrow into their own typed interfaces — PublicIPResult, VMResult and the
 * rest — so the shape is asserted there rather than here. */
// deno-lint-ignore no-explicit-any
type AzureJson = Record<string, any>;

export async function azureGet(token: string, url: string): Promise<AzureJson> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const error = await res.text();
    throw new AzureAPIError('GET_FAILED', `GET ${url}: ${error}`, res.status);
  }
  return res.json();
}

export async function azurePut(token: string, url: string, body: Record<string, unknown>): Promise<AzureJson> {
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new AzureAPIError('PUT_FAILED', `PUT ${url}: ${error}`, res.status);
  }

  return res.json();
}

export async function azurePatch(token: string, url: string, body: Record<string, unknown>): Promise<AzureJson> {
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new AzureAPIError('PATCH_FAILED', `PATCH ${url}: ${error}`, res.status);
  }

  // PATCH may return 200 or 204
  if (res.status === 204) {
    return {};
  }
  return res.json();
}

export async function azurePost(token: string, url: string, body: Record<string, unknown>): Promise<AzureJson> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new AzureAPIError('POST_FAILED', `POST ${url}: ${error}`, res.status);
  }

  // POST may return 200, 201, 202, or 204
  if (res.status === 202) {
    // Async operation — check for Location/Azure-AsyncOperation header
    const asyncUrl = res.headers.get('Azure-AsyncOperation') || res.headers.get('Location');
    if (asyncUrl) {
      return { _asyncOperationUrl: asyncUrl };
    }
  }

  if (res.status === 204) {
    return {};
  }

  const text = await res.text();
  if (!text) return {};
  return JSON.parse(text);
}

export async function azureDelete(token: string, url: string): Promise<void> {
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });

  // 200, 202 (async), 204 (already deleted) are all ok
  if (!res.ok && res.status !== 404) {
    const error = await res.text();
    throw new AzureAPIError('DELETE_FAILED', `DELETE ${url}: ${error}`, res.status);
  }
}

// ============================================================================
// Polling Helpers
// ============================================================================

export async function pollAsyncOperation(token: string, url: string, maxAttempts = 60): Promise<string> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const data = await azureGet(token, url);
    const status = (data as Record<string, string>).status;
    if (status === 'Succeeded') {
      const output = (data as Record<string, unknown>).properties;
      return output ? JSON.stringify(output) : '';
    }
    if (status === 'Failed') {
      throw new AzureAPIError('ASYNC_FAILED', `Async operation failed: ${JSON.stringify(data)}`, 500);
    }
  }
  throw new AzureAPIError('TIMEOUT', 'Timed out waiting for async operation', 408);
}

export async function waitForDeletion(token: string, url: string, maxAttempts = 60): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    try {
      await azureGet(token, url);
    } catch (err) {
      if (err instanceof AzureAPIError && err.status === 404) {
        return; // Resource deleted
      }
      throw err;
    }
  }
  throw new AzureAPIError('TIMEOUT', 'Timed out waiting for resource deletion', 408);
}
