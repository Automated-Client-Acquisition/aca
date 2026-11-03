import { PUBLIC_SITE_URL, SUPPORT_EMAIL } from "../_shared/site-config.ts";
const SERVER_METADATA = {
  mcp_version: "2024-11-05",
  name: "aca",
  description:
    "AI-powered content generation and multi-channel outreach platform. Generate on-brand social content, manage leads and CRM contacts, run LinkedIn/email/WhatsApp campaigns, and automate client acquisition - all from your AI agent.",
  version: "1.0.0",
  endpoints: [
    {
      uri: `${PUBLIC_SITE_URL}/api/mcp`,
      transport: "http",
      tls: true,
    },
  ],
  capabilities: {
    tools: true,
    resources: false,
    prompts: false,
    sampling: false,
  },
  authentication: {
    type: "api_key",
    location: "header",
    description:
      "Pass your API key as a Bearer token in the Authorization header. Generate keys from the ACA dashboard under Settings > MCP / API.",
  },
  documentation_url:
    `${PUBLIC_SITE_URL}/docs/integrations`,
  support_email: SUPPORT_EMAIL,
  tags: [
    "ai",
    "content-generation",
    "outreach",
    "crm",
    "linkedin",
    "email",
    "whatsapp",
    "campaigns",
    "lead-generation",
    "social-media",
  ],
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "public, max-age=3600",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: CORS_HEADERS,
    });
  }

  return new Response(JSON.stringify(SERVER_METADATA, null, 2), {
    status: 200,
    headers: CORS_HEADERS,
  });
});
