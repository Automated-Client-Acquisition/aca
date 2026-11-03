/** ACA OAuth 2.1 token service for remote MCP clients.
 *
 * The browser consent page authenticates the ACA user and POSTs `authorize`
 * with that user's Supabase JWT. This function intentionally does not accept
 * CLI/API keys for consent, preventing a copied long-lived key from silently
 * becoming a connector grant.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { authenticateRequest } from "../_shared/cli-auth.ts";
import {
  OAuthError,
  MCP_SCOPES,
  parseScope,
  randomToken,
  REFRESH_PREFIX,
  sha256,
  validateClient,
  validateDynamicRedirectUris,
} from "../_shared/mcp-oauth.ts";
import { APP_URL, PUBLIC_SITE_URL } from "../_shared/site-config.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const ACCESS_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;

function publicIssuer(url: URL) {
  return (Deno.env.get("MCP_OAUTH_ISSUER") ||
    `https://${url.host}/functions/v1/mcp-oauth`).replace(/\/$/, "");
}

function resourceUrl(issuer: string) {
  return `${issuer.replace(/\/oauth$/, "")}/mcp`;
}

function assertResource(value: unknown, issuer: string) {
  if (typeof value !== "string" || value !== resourceUrl(issuer)) {
    throw new OAuthError(
      "invalid_target",
      "resource must identify the ACA MCP endpoint",
    );
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors });
}
function formResponse(error: unknown) {
  const e = error instanceof OAuthError
    ? error
    : new OAuthError("server_error", "Authorization service unavailable", 500);
  return json({ error: e.code, error_description: e.message }, e.status);
}
function service() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}
function asString(value: unknown, name: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new OAuthError("invalid_request", `${name} is required`);
  }
  return value.trim();
}
async function payload(req: Request): Promise<Record<string, unknown>> {
  const contentType = req.headers.get("content-type") || "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(await req.formData());
  }
  try {
    return await req.json() as Record<string, unknown>;
  } catch {
    throw new OAuthError(
      "invalid_request",
      "Request body must be valid JSON or form data",
    );
  }
}

async function issueTokens(
  supabase: ReturnType<typeof service>,
  grant: {
    client_id: string;
    user_id: string;
    organization_id: string;
    scopes: string[];
    rotated_from_id?: string;
  },
) {
  const accessToken = randomToken("aca_mcp_");
  const refreshToken = randomToken(REFRESH_PREFIX);
  const now = Date.now();
  const { error } = await supabase.from("mcp_oauth_tokens").insert({
    access_token_hash: await sha256(accessToken),
    refresh_token_hash: await sha256(refreshToken),
    client_id: grant.client_id,
    user_id: grant.user_id,
    organization_id: grant.organization_id,
    scopes: grant.scopes,
    rotated_from_id: grant.rotated_from_id ?? null,
    access_expires_at: new Date(now + ACCESS_TTL_SECONDS * 1000).toISOString(),
    refresh_expires_at: new Date(now + REFRESH_TTL_SECONDS * 1000)
      .toISOString(),
  });
  if (error) {
    throw new OAuthError("server_error", "Unable to issue credentials", 500);
  }
  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: ACCESS_TTL_SECONDS,
    refresh_token: refreshToken,
    scope: grant.scopes.join(" "),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }
  const url = new URL(req.url);
  const routeOperation = url.searchParams.get("op") || "metadata";
  try {
    if (req.method === "GET" && routeOperation === "metadata") {
      // Edge functions receive an internal http:// request URL. OAuth metadata
      // must advertise its public HTTPS issuer, never that internal address.
      const origin = publicIssuer(url);
      return json({
        issuer: origin,
        authorization_endpoint: `${origin}/authorize`,
        token_endpoint: `${origin}/token`,
        revocation_endpoint: `${origin}/revoke`,
        registration_endpoint: `${origin}/register`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        token_endpoint_auth_methods_supported: ["none"],
        authorization_response_iss_parameter_supported: true,
        code_challenge_methods_supported: ["S256"],
        scopes_supported: MCP_SCOPES,
      });
    }
    if (req.method === "GET" && routeOperation === "protected-resource") {
      const issuer = publicIssuer(url);
      return json({
        resource: resourceUrl(issuer),
        authorization_servers: [issuer],
        bearer_methods_supported: ["header"],
        scopes_supported: MCP_SCOPES,
        resource_documentation:
          `${PUBLIC_SITE_URL}/product/integrations/mcp`,
        resource_policy_uri: `${PUBLIC_SITE_URL}/privacy`,
        resource_tos_uri: `${PUBLIC_SITE_URL}/terms`,
      });
    }
    // OAuth clients navigate here in a browser. The ACA app owns the logged-in
    // consent UI and forwards the signed-in user's JWT to POST authorize.
    if (req.method === "GET" && routeOperation === "authorize") {
      const appUrl = (Deno.env.get("ACA_APP_URL") ||
        APP_URL).replace(/\/$/, "");
      const consentUrl = new URL(`${appUrl}/connect/authorize`);
      for (const [key, value] of url.searchParams) {
        if (key !== "op") consentUrl.searchParams.set(key, value);
      }
      // Best-effort: forward the registered client's display name so the
      // consent screen can show it instead of the raw client_id. A lookup
      // failure here isn't fatal -- the POST authorize step re-validates
      // the client for real and rejects an unknown one.
      const clientId = url.searchParams.get("client_id");
      if (clientId) {
        const { data: client } = await service().from("mcp_oauth_clients")
          .select("client_name").eq("client_id", clientId).maybeSingle();
        if (client?.client_name) {
          consentUrl.searchParams.set("client_name", client.client_name);
        }
      }
      return Response.redirect(consentUrl.toString(), 302);
    }
    if (req.method === "GET" && routeOperation === "openai-challenge") {
      const token = Deno.env.get("OPENAI_APPS_CHALLENGE") || "";
      if (!token) return new Response("Not found", { status: 404 });
      return new Response(token, {
        headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" },
      });
    }
    const body = await payload(req);
    const operation = typeof body.operation === "string"
      ? body.operation
      : routeOperation;
    const supabase = service();
    if (operation === "register") {
      if (req.method !== "POST") {
        throw new OAuthError("invalid_request", "Client registration requires POST");
      }
      const redirectUris = validateDynamicRedirectUris(body.redirect_uris);
      const clientId = randomToken("aca_mcp_client_");
      // client_name is an optional RFC 7591 field the registering app may
      // send (Claude and ChatGPT both do). Only used for display on the
      // consent screen, so a missing/oversized value degrades gracefully.
      const clientName = typeof body.client_name === "string"
        ? body.client_name.trim().slice(0, 120) || null
        : null;
      const { error } = await supabase.from("mcp_oauth_clients").insert({
        client_id: clientId,
        client_name: clientName,
        redirect_uris: redirectUris,
        allowed_scopes: MCP_SCOPES,
      });
      if (error) {
        throw new OAuthError("server_error", "Unable to register OAuth client", 500);
      }
      return json({
        client_id: clientId,
        redirect_uris: redirectUris,
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      }, 201);
    }
    if (operation === "authorize") {
      const caller = await authenticateRequest(req, supabase);
      if (caller.auth_method !== "jwt") {
        throw new OAuthError(
          "invalid_request",
          "Authorization consent requires an ACA browser session",
          401,
        );
      }
      const clientId = asString(body.client_id, "client_id");
      const redirectUri = asString(body.redirect_uri, "redirect_uri");
      const state = asString(body.state, "state");
      const challenge = asString(body.code_challenge, "code_challenge");
      const issuer = publicIssuer(url);
      assertResource(body.resource, issuer);
      if (body.code_challenge_method !== "S256") {
        throw new OAuthError("invalid_request", "PKCE S256 is required");
      }
      const client = await validateClient(supabase, clientId, redirectUri);
      const requested = parseScope(body.scope);
      const scopes = requested.filter((scope) =>
        client.allowed_scopes.includes(scope)
      );
      if (scopes.length !== requested.length) {
        throw new OAuthError(
          "invalid_scope",
          "A requested scope is not allowed for this client",
        );
      }
      const code = randomToken("aca_mcp_code_");
      const { error } = await supabase.from("mcp_oauth_authorization_codes")
        .insert({
          code_hash: await sha256(code),
          client_id: clientId,
          redirect_uri: redirectUri,
          code_challenge: challenge,
          user_id: caller.user_id,
          organization_id: caller.organization_id,
          scopes,
          expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        });
      if (error) {
        throw new OAuthError(
          "server_error",
          "Unable to create authorization code",
          500,
        );
      }
      const redirect = new URL(redirectUri);
      redirect.searchParams.set("code", code);
      redirect.searchParams.set("state", state);
      redirect.searchParams.set("iss", issuer);
      return json({ redirect_to: redirect.toString() });
    }
    if (operation === "token") {
      const grantType = asString(body.grant_type, "grant_type");
      const clientId = asString(body.client_id, "client_id");
      assertResource(body.resource, publicIssuer(url));
      if (grantType === "authorization_code") {
        const code = asString(body.code, "code");
        const redirectUri = asString(body.redirect_uri, "redirect_uri");
        const verifier = asString(body.code_verifier, "code_verifier");
        await validateClient(supabase, clientId, redirectUri);
        const { data: grant } = await supabase.from(
          "mcp_oauth_authorization_codes",
        ).select("*").eq("code_hash", await sha256(code)).maybeSingle();
        if (
          !grant || grant.consumed_at || grant.client_id !== clientId ||
          grant.redirect_uri !== redirectUri ||
          new Date(grant.expires_at).getTime() <= Date.now()
        ) {
          throw new OAuthError(
            "invalid_grant",
            "Authorization code is invalid, expired, or already used",
          );
        }
        const verifierHash = await sha256(verifier);
        const expected = btoa(
          String.fromCharCode(
            ...Uint8Array.from(
              verifierHash.match(/.{2}/g)!.map((v) => parseInt(v, 16)),
            ),
          ),
        ).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
        if (expected !== grant.code_challenge) {
          throw new OAuthError("invalid_grant", "PKCE verification failed");
        }
        const { data: consumed } = await supabase.from(
          "mcp_oauth_authorization_codes",
        ).update({ consumed_at: new Date().toISOString() }).eq("id", grant.id)
          .is("consumed_at", null).select("id").maybeSingle();
        if (!consumed) {
          throw new OAuthError(
            "invalid_grant",
            "Authorization code was already used",
          );
        }
        return json(await issueTokens(supabase, grant));
      }
      if (grantType === "refresh_token") {
        const refresh = asString(body.refresh_token, "refresh_token");
        const { data: grant } = await supabase.from("mcp_oauth_tokens").select(
          "*",
        ).eq("refresh_token_hash", await sha256(refresh)).maybeSingle();
        if (
          !grant || grant.revoked_at || grant.client_id !== clientId ||
          new Date(grant.refresh_expires_at).getTime() <= Date.now()
        ) {
          throw new OAuthError(
            "invalid_grant",
            "Refresh token is invalid, expired, or revoked",
          );
        }
        const { data: revoked } = await supabase.from("mcp_oauth_tokens")
          .update({ revoked_at: new Date().toISOString() }).eq("id", grant.id)
          .is("revoked_at", null).select("id").maybeSingle();
        if (!revoked) {
          throw new OAuthError(
            "invalid_grant",
            "Refresh token was already used",
          );
        }
        return json(
          await issueTokens(supabase, { ...grant, rotated_from_id: grant.id }),
        );
      }
      throw new OAuthError(
        "unsupported_grant_type",
        "Only authorization_code and refresh_token are supported",
      );
    }
    if (operation === "revoke") {
      const token = asString(body.token, "token");
      const hash = await sha256(token);
      await supabase.from("mcp_oauth_tokens").update({
        revoked_at: new Date().toISOString(),
      }).or(`access_token_hash.eq.${hash},refresh_token_hash.eq.${hash}`);
      return new Response(null, { status: 200, headers: cors });
    }
    return json({ error: "not_found" }, 404);
  } catch (error) {
    return formResponse(error);
  }
});
