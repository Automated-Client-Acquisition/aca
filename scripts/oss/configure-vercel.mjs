#!/usr/bin/env node
/**
 * Fill in vercel.json for a self-hosted ACA install.
 *
 *   node scripts/oss/configure-vercel.mjs [template] [output]
 *
 * Vercel rewrites can't read environment variables, so the template carries
 * placeholders that this script replaces from your environment (or .env):
 *
 *   __SUPABASE_URL__ / __SUPABASE_HOST__   from VITE_SUPABASE_URL (or SUPABASE_URL)
 *   __API_HOST__                           from VITE_API_URL's host  (e.g. api.example.com)
 *   __MCP_HOST__                           from MCP_URL's host       (e.g. mcp.example.com)
 *
 * Defaults: template oss/vercel.template.json, output vercel.json.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const [templatePath = "oss/vercel.template.json", outputPath = "vercel.json"] = process.argv.slice(2);

function loadDotEnv(path = ".env") {
  if (!existsSync(path)) return {};
  const vars = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match) vars[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return vars;
}

const env = { ...loadDotEnv(), ...process.env };

function hostOf(name) {
  const value = env[name];
  if (!value) return undefined;
  try {
    return new URL(value).host;
  } catch {
    throw new Error(`${name} is not a URL: ${value}`);
  }
}

const supabaseUrl = (env.VITE_SUPABASE_URL || env.SUPABASE_URL || "").replace(/\/+$/, "");
const values = {
  __SUPABASE_URL__: supabaseUrl,
  __SUPABASE_HOST__: supabaseUrl ? new URL(supabaseUrl).host : "",
  __API_HOST__: hostOf("VITE_API_URL") ?? "",
  __MCP_HOST__: hostOf("MCP_URL") ?? "",
};

const missing = Object.entries(values).filter(([, v]) => !v).map(([k]) => k);
if (missing.length) {
  console.error(
    `Missing values for ${missing.join(", ")}. Set VITE_SUPABASE_URL, VITE_API_URL and MCP_URL in .env.`,
  );
  process.exit(1);
}

let text = readFileSync(templatePath, "utf8");
for (const [token, value] of Object.entries(values)) text = text.split(token).join(value);
JSON.parse(text); // fail loudly rather than write a broken vercel.json
writeFileSync(outputPath, text);
console.log(`Wrote ${outputPath} for ${values.__SUPABASE_HOST__} (API ${values.__API_HOST__}, MCP ${values.__MCP_HOST__})`);
