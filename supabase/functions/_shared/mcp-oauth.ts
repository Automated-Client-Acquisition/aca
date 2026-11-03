import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";

export const MCP_SCOPES = [
  "workspace:read",
  "contacts:read",
  "contacts:write",
  "sequences:read",
  "sequences:write",
  "tags:read",
  "tags:write",
  "stages:read",
  "stages:write",
  "conversations:read",
  "messages:read",
  "messages:write",
  "analytics:read",
  "lead-lists:read",
  "lead-lists:write",
  "content:read",
  "content:write",
  "blueprints:read",
  "blueprints:write",
  "agents:read",
  "agents:write",
  "campaigns:read",
  "campaigns:write",
  "lead-magnets:read",
  "lead-magnets:write",
] as const;

export type McpCaller = {
  user_id: string;
  organization_id: string;
  client_id: string;
  scopes: string[];
  token_id: string;
};

const ACCESS_PREFIX = "aca_mcp_";
const REFRESH_PREFIX = "aca_mcp_refresh_";

export function parseScope(scope: unknown): string[] {
  const values = typeof scope === "string"
    ? scope.split(/\s+/).filter(Boolean)
    : [];
  const invalid = values.filter((value) =>
    !MCP_SCOPES.includes(value as typeof MCP_SCOPES[number])
  );
  if (invalid.length) {
    throw new OAuthError(
      "invalid_scope",
      `Unsupported scope: ${invalid.join(", ")}`,
      400,
    );
  }
  return [...new Set(values)];
}

export class OAuthError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

export function validateDynamicRedirectUris(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 10) {
    throw new OAuthError(
      "invalid_client_metadata",
      "redirect_uris must contain between 1 and 10 URLs",
    );
  }

  const uris = value.map((entry) => {
    if (typeof entry !== "string") {
      throw new OAuthError(
        "invalid_client_metadata",
        "redirect_uris must contain only strings",
      );
    }

    let url: URL;
    try {
      url = new URL(entry);
    } catch {
      throw new OAuthError("invalid_client_metadata", "Invalid redirect URI");
    }

    const isHttps = url.protocol === "https:";
    const isLoopbackHttp = url.protocol === "http:" &&
      ["127.0.0.1", "[::1]", "::1"].includes(url.hostname);
    if (
      (!isHttps && !isLoopbackHttp) ||
      url.username ||
      url.password ||
      url.hash
    ) {
      throw new OAuthError(
        "invalid_client_metadata",
        "redirect URIs must use HTTPS or an HTTP loopback address, without credentials or fragments",
      );
    }

    return url.toString();
  });

  return [...new Set(uris)];
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest)).map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

export function randomToken(prefix: string): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let raw = "";
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return `${prefix}${
    btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
  }`;
}

export async function validateClient(
  supabase: SupabaseClient,
  clientId: string,
  redirectUri: string,
) {
  const { data, error } = await supabase.from("mcp_oauth_clients")
    .select("client_id, redirect_uris, allowed_scopes, is_active").eq(
      "client_id",
      clientId,
    ).maybeSingle();
  if (error || !data || !data.is_active) {
    throw new OAuthError(
      "unauthorized_client",
      "Unknown or inactive OAuth client",
      400,
    );
  }
  if (
    !Array.isArray(data.redirect_uris) ||
    !data.redirect_uris.includes(redirectUri)
  ) {
    throw new OAuthError(
      "invalid_request",
      "redirect_uri is not registered for this client",
      400,
    );
  }
  return data as {
    client_id: string;
    redirect_uris: string[];
    allowed_scopes: string[];
    is_active: boolean;
  };
}

export async function resolveMcpAccessToken(
  supabase: SupabaseClient,
  token: string,
  options: { trackLastUsed?: boolean } = {},
): Promise<McpCaller> {
  if (!token.startsWith(ACCESS_PREFIX)) {
    throw new OAuthError(
      "AUTH_REQUIRED",
      "An ACA OAuth access token is required",
      401,
    );
  }
  const hash = await sha256(token);
  const { data, error } = await supabase.from("mcp_oauth_tokens")
    .select(
      "id, client_id, user_id, organization_id, scopes, access_expires_at, revoked_at",
    )
    .eq("access_token_hash", hash).maybeSingle();
  if (
    error || !data || data.revoked_at ||
    new Date(data.access_expires_at).getTime() <= Date.now()
  ) {
    throw new OAuthError(
      "AUTH_REQUIRED",
      "The ACA OAuth access token is invalid, expired, or revoked",
      401,
    );
  }
  // Directory-facing read tools must not write usage telemetry during auth.
  if (options.trackLastUsed !== false) {
    await supabase.from("mcp_oauth_tokens").update({
      last_used_at: new Date().toISOString(),
    }).eq("id", data.id);
  }
  return {
    token_id: data.id,
    client_id: data.client_id,
    user_id: data.user_id,
    organization_id: data.organization_id,
    scopes: data.scopes || [],
  };
}

export function assertScope(caller: McpCaller, scope: string) {
  if (!caller.scopes.includes(scope)) {
    throw new OAuthError(
      "INSUFFICIENT_SCOPE",
      `This action requires the ${scope} permission`,
      403,
    );
  }
}

export function isRefreshToken(token: string) {
  return token.startsWith(REFRESH_PREFIX);
}
export { ACCESS_PREFIX, REFRESH_PREFIX };
