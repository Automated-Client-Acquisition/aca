// Autoblog Orchestrator — daily cron or manual HTTP POST.
//
// Per run:
//   1. Pick up to MAX_POSTS_PER_RUN briefs from Notion (Status=Brief AND Created unchecked)
//   2. Lock each row to Drafting (sibling-run race protection)
//   3. Fetch shared context once (DESIGN.md, HERO_STYLE.md, type def, sibling posts) via GitHub
//   4. For each brief: call DeepSeek V4 Pro via OpenRouter to produce a BlogPost JSON
//   5. Upsert each post to the blog_posts Supabase table (no GitHub commit, no Vercel rebuild)
//   6. Fire Replicate hero (async, webhook-completed); ping Google + IndexNow
//   7. Mark each Notion row Published with all metadata fields
//
// Required secrets:
//   - OPENROUTER_API_KEY (routes to deepseek/deepseek-v4-flash)
//   - NOTION_API_KEY
//   - GITHUB_TOKEN (read-only: fetches DESIGN.md, HERO_STYLE.md, example posts)
//   - REPLICATE_API_TOKEN
//   - AUTOBLOG_WEBHOOK_SECRET
//   - ORCHESTRATOR_SECRET (gates non-service-role callers)
//   - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "npm:@supabase/supabase-js@^2";
import { corsHeaders } from "../_shared/cors.ts";
import { PUBLIC_SITE_HOST } from "../_shared/site-config.ts";

// ── Constants ────────────────────────────────────────────────────────────────

const REPO_OWNER = "seguelaCedric";
const REPO_NAME = "screenshot-perfect";
const REPO_BRANCH = "main";
const MAX_POSTS_PER_RUN = 1;

const NOTION_VERSION = "2022-06-28";
const PAGES_DS_ID = "a4cd04da-a046-49c0-be73-f64aeb714fdc";

const SITE_HOST = PUBLIC_SITE_HOST;
const SITE_BASE = `https://${SITE_HOST}`;

const INDEXNOW_KEY = "26b8f520edc7ac289e448fce828276d4";
const INDEXNOW_KEY_LOCATION = `${SITE_BASE}/${INDEXNOW_KEY}.txt`;

const CTA_HREF = "https://www.skool.com/aca-xtreme";

const DEEPSEEK_MODEL = "deepseek/deepseek-v4-flash";
const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const OPENROUTER_REFERER = SITE_BASE;
const OPENROUTER_TITLE = "ACA Autoblog";

const SIBLING_PILLAR_SLUG = "how-to-make-money-with-ai";
const SIBLING_SPOKE_SLUG = "cold-email-deliverability";
const SIBLING_COMPARISON_SLUG = "aca-vs-lemlist";

// ── Types ────────────────────────────────────────────────────────────────────

type PageType =
  | "Pillar"
  | "Spoke"
  | "Comparison"
  | "Alternatives"
  | "UseCase"
  | "Glossary"
  | "Editorial"
  | "Programmatic";

interface Brief {
  pageId: string;
  title: string;
  slug: string;
  cluster: string;
  pageType: PageType;
  briefNotes: string;
  primaryKeyword: string;
  intent: string;
  serpType: string;
}

interface GeneratedPost {
  slug: string;
  title: string;
  description: string;
  category: string;
  cluster: string;
  pageType: PageType;
  content: string;
  tableOfContents: Array<{ id: string; title: string; level: 2 | 3 }>;
  relatedSlugs: string[];
  keywords: string[];
  ctaText: string;
  wordCount: number;
  readTime: string;
  heroPrompt: string;
}

interface PostOutcome {
  pageId: string;
  slug: string;
  status: "published" | "failed";
  error?: string;
  dbId?: string;
  predictionId?: string;
  googleIndexed?: boolean;
  indexNowOk?: boolean;
}

// ── Notion helpers ───────────────────────────────────────────────────────────

const NOTION_HEADERS = (key: string) => ({
  "Authorization": `Bearer ${key}`,
  "Notion-Version": NOTION_VERSION,
  "Content-Type": "application/json",
});

async function notionQuery(
  notionKey: string,
  dsId: string,
  body: Record<string, unknown>,
): Promise<{ results: Array<Record<string, unknown>> }> {
  const resp = await fetch(`https://api.notion.com/v1/databases/${dsId}/query`, {
    method: "POST",
    headers: NOTION_HEADERS(notionKey),
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`Notion query ${resp.status}: ${await resp.text()}`);
  return resp.json();
}

async function notionGetPage(notionKey: string, pageId: string): Promise<Record<string, unknown>> {
  const resp = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    headers: NOTION_HEADERS(notionKey),
  });
  if (!resp.ok) throw new Error(`Notion get ${resp.status}: ${await resp.text()}`);
  return resp.json();
}

async function notionUpdatePage(
  notionKey: string,
  pageId: string,
  properties: Record<string, unknown>,
): Promise<void> {
  const resp = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: "PATCH",
    headers: NOTION_HEADERS(notionKey),
    body: JSON.stringify({ properties }),
  });
  if (!resp.ok) throw new Error(`Notion update ${resp.status}: ${await resp.text()}`);
}

// deno-lint-ignore no-explicit-any
function propValue(prop: any): string {
  if (!prop) return "";
  if (prop.type === "title") return (prop.title ?? []).map((t: { plain_text: string }) => t.plain_text).join("");
  if (prop.type === "rich_text") return (prop.rich_text ?? []).map((t: { plain_text: string }) => t.plain_text).join("");
  if (prop.type === "select") return prop.select?.name ?? "";
  if (prop.type === "multi_select") return (prop.multi_select ?? []).map((o: { name: string }) => o.name).join(", ");
  if (prop.type === "number") return prop.number?.toString() ?? "";
  if (prop.type === "checkbox") return prop.checkbox ? "true" : "false";
  if (prop.type === "date") return prop.date?.start ?? "";
  if (prop.type === "url") return prop.url ?? "";
  if (prop.type === "relation") return (prop.relation ?? []).map((r: { id: string }) => r.id).join(",");
  return "";
}

function sanitizeSlug(slug: string): string {
  return slug.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

// ── Brief loading ────────────────────────────────────────────────────────────

async function pickBriefs(notionKey: string): Promise<Brief[]> {
  const result = await notionQuery(notionKey, PAGES_DS_ID, {
    filter: {
      and: [
        { property: "Status", select: { equals: "Brief" } },
        { property: "Created", checkbox: { equals: false } },
      ],
    },
    sorts: [
      { property: "Scheduled For", direction: "ascending" },
      { timestamp: "created_time", direction: "ascending" },
    ],
    page_size: MAX_POSTS_PER_RUN,
  });
  const briefs: Brief[] = [];
  for (const row of result.results) {
    // deno-lint-ignore no-explicit-any
    const props = (row as any).properties;
    // Primary Keyword is a relation — resolve the page title of the first related keyword page.
    // deno-lint-ignore no-explicit-any
    const kwRelation = (props["Primary Keyword"]?.relation ?? []) as Array<{ id: string }>;
    let primaryKeyword = "";
    if (kwRelation.length > 0) {
      try {
        const kwPage = await notionGetPage(notionKey, kwRelation[0].id);
        // deno-lint-ignore no-explicit-any
        const kwProps = (kwPage as any).properties ?? {};
        primaryKeyword = propValue(kwProps["Name"] ?? kwProps["Keyword"] ?? kwProps["title"] ?? Object.values(kwProps).find((p: unknown) => (p as Record<string,string>).type === "title"));
      } catch { /* skip if lookup fails */ }
    }
    briefs.push({
      // deno-lint-ignore no-explicit-any
      pageId: (row as any).id,
      title: propValue(props["Page Title"]) || propValue(props["Name"]),
      slug: sanitizeSlug(propValue(props["Slug"])),
      cluster: propValue(props["Cluster"]),
      pageType: (propValue(props["Page Type"]) || "Spoke") as PageType,
      briefNotes: propValue(props["Brief / Notes"]) || propValue(props["Brief"]) || "",
      primaryKeyword,
      intent: propValue(props["Intent"]),
      serpType: propValue(props["SERP Type"]),
    });
  }
  return briefs.filter((b) => b.slug && b.title);
}

async function lockBrief(notionKey: string, pageId: string): Promise<void> {
  await notionUpdatePage(notionKey, pageId, { "Status": { select: { name: "Drafting" } } });
}

async function revertBrief(notionKey: string, pageId: string, reason: string): Promise<void> {
  try {
    await notionUpdatePage(notionKey, pageId, {
      "Status": { select: { name: "Brief" } },
      "Brief / Notes": { rich_text: [{ text: { content: `[Orchestrator failure] ${reason}` } }] },
    });
  } catch (e) {
    console.error(`Failed to revert ${pageId}: ${e instanceof Error ? e.message : e}`);
  }
}

// ── Related slugs ────────────────────────────────────────────────────────────

async function pickRelatedSlugs(
  notionKey: string,
  cluster: string,
  excludeSlug: string,
): Promise<string[]> {
  if (!cluster) return [];
  let queryResult: { results: Array<Record<string, unknown>> };
  try {
    queryResult = await notionQuery(notionKey, PAGES_DS_ID, {
      filter: {
        and: [
          { property: "Cluster", select: { equals: cluster } },
          {
            or: [
              { property: "Status", select: { equals: "Published" } },
              { property: "Status", select: { equals: "Indexed" } },
              { property: "Status", select: { equals: "Ranking" } },
            ],
          },
        ],
      },
      page_size: 20,
    });
  } catch {
    return [];
  }
  const slugs: string[] = [];
  for (const row of queryResult.results) {
    // deno-lint-ignore no-explicit-any
    const slug = sanitizeSlug(propValue((row as any).properties["Slug"]));
    if (slug && slug !== excludeSlug) slugs.push(slug);
    if (slugs.length >= 6) break;
  }
  return slugs;
}

async function resolveLinksToRelations(
  notionKey: string,
  slugs: string[],
): Promise<Array<{ id: string }>> {
  const out: Array<{ id: string }> = [];
  for (const slug of slugs) {
    try {
      const r = await notionQuery(notionKey, PAGES_DS_ID, {
        filter: { property: "Slug", rich_text: { equals: slug } },
        page_size: 1,
      });
      // deno-lint-ignore no-explicit-any
      const id = (r.results[0] as any)?.id;
      if (id) out.push({ id });
    } catch { /* skip */ }
  }
  return out;
}

async function incrementInternalLinksIn(notionKey: string, pageId: string): Promise<void> {
  try {
    const page = await notionGetPage(notionKey, pageId);
    // deno-lint-ignore no-explicit-any
    const current = (page as any).properties?.["Internal Links In"]?.number ?? 0;
    await notionUpdatePage(notionKey, pageId, { "Internal Links In": { number: current + 1 } });
  } catch (e) {
    console.warn(`increment Internal Links In ${pageId} failed: ${e instanceof Error ? e.message : e}`);
  }
}

// ── GitHub (read-only, for context files) ───────────────────────────────────

function decodeBase64(b64: string): string {
  const clean = b64.replace(/\s+/g, "");
  return new TextDecoder().decode(Uint8Array.from(atob(clean), (c) => c.charCodeAt(0)));
}

async function ghGetFile(token: string, filePath: string): Promise<{ sha: string; content: string } | null> {
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${filePath}?ref=${REPO_BRANCH}`;
  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`gh GET ${filePath} ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  return { sha: data.sha, content: decodeBase64(data.content) };
}

interface RunContext {
  designContract: string;
  heroStyle: string;
  typeDef: string;
  examplePillar: string;
  exampleSpoke: string;
  exampleComparison: string;
}

async function loadRunContext(ghToken: string): Promise<RunContext> {
  const [design, hero, types, pillar, spoke, comparison] = await Promise.all([
    ghGetFile(ghToken, "src/data/blogPosts/DESIGN.md"),
    ghGetFile(ghToken, "src/data/blogPosts/HERO_STYLE.md"),
    ghGetFile(ghToken, "src/data/blogPosts/blogPosts.types.ts"),
    ghGetFile(ghToken, `src/data/blogPosts/${SIBLING_PILLAR_SLUG}.ts`),
    ghGetFile(ghToken, `src/data/blogPosts/${SIBLING_SPOKE_SLUG}.ts`),
    ghGetFile(ghToken, `src/data/blogPosts/${SIBLING_COMPARISON_SLUG}.ts`),
  ]);
  if (!design || !hero || !types || !pillar || !spoke || !comparison) {
    throw new Error("Missing one of the context files in the repo");
  }
  return {
    designContract: design.content,
    heroStyle: hero.content,
    typeDef: types.content,
    examplePillar: pillar.content,
    exampleSpoke: spoke.content,
    exampleComparison: comparison.content,
  };
}

// ── DeepSeek V4 Pro via OpenRouter ───────────────────────────────────────────

function buildSystemPrompt(ctx: RunContext): string {
  return `You are the ACA Autoblog Writer. You produce SEO blog posts for Automated Client Acquisition (ACA), a multi-channel outbound platform for AI agencies.

Your job: read a brief and produce a single JSON object. Output ONLY valid JSON — no markdown fences, no commentary before or after.

## Hard rules (never violate)

1. CTA always points to https://www.skool.com/aca-xtreme.
2. Never use em dashes. Use regular hyphens or rewrite the sentence.
3. No fake stats. If you don't have a verified number, frame as "in our experience" or rewrite without the number.
4. Apply the design contract literally: <p class="lead"> with 60-100 word direct answer, at least 3 capsules with .direct-answer/.tldr/.definition/.decision/.stat classes, FAQ section with id="faq" and Q-shaped H3s.
5. H2 ids in content must match tableOfContents entries exactly.
6. Internal links use relative paths (/blog/<slug> or /<app-path>). Never hardcode the domain.
7. Word count by page type: Pillar 3000-5000, Spoke 1500-2500, Comparison 2000-3000, Alternatives 2000-3000, UseCase 1500-2500, Glossary 800-1500, Editorial 1200-2000.
8. wordCount must reflect the actual word count of the HTML content (text only, exclude tags).

## Voice

Direct, founder-built, slightly contrarian. Address the reader's actual problem. No "revolutionary", no "in conclusion", no validation-forward fluff. Use "we" sparingly, "you" liberally. Open with the searcher's intent in the lead paragraph.

## Required JSON shape

{
  "title": string,
  "description": string,
  "category": string,        // one of: Comparison, Outbound, Cold Email, LinkedIn, AI Agency, Strategy, Lead Generation, Tools
  "content": string,         // full HTML article
  "tableOfContents": [{ "id": string, "title": string, "level": 2 | 3 }],
  "keywords": string[],
  "wordCount": number,
  "readTime": string,        // e.g. "8 min read"
  "heroPrompt": string       // single-paragraph Replicate image prompt per the Hero Image Style Guide
}

Do NOT include slug, publishDate, modifiedDate, author, authorRole, featured, coverImage, relatedSlugs, cluster, pageType, ctaText, or ctaHref.

## Design contract (DESIGN.md)

${ctx.designContract}

## Hero image style guide (HERO_STYLE.md)

${ctx.heroStyle}

## Type definition

\`\`\`ts
${ctx.typeDef}
\`\`\`

## Example: Pillar (${SIBLING_PILLAR_SLUG})

\`\`\`ts
${ctx.examplePillar}
\`\`\`

## Example: Spoke (${SIBLING_SPOKE_SLUG})

\`\`\`ts
${ctx.exampleSpoke}
\`\`\`

## Example: Comparison (${SIBLING_COMPARISON_SLUG})

\`\`\`ts
${ctx.exampleComparison}
\`\`\``;
}

function buildUserPrompt(brief: Brief, related: string[]): string {
  return `Write a blog post for this brief.

<page_title>${brief.title}</page_title>
<slug>${brief.slug}</slug>
<page_type>${brief.pageType}</page_type>
<cluster>${brief.cluster}</cluster>
<primary_keyword>${brief.primaryKeyword || "(not specified)"}</primary_keyword>
<search_intent>${brief.intent || "(not specified)"}</search_intent>
<serp_type>${brief.serpType || "(not specified)"}</serp_type>

<brief_notes>
${brief.briefNotes || "(no detailed brief — write from the title and page type)"}
</brief_notes>

<suggested_internal_links>
${related.length === 0 ? "(none)" : related.map((s) => `- /blog/${s}`).join("\n")}
</suggested_internal_links>

Output the JSON now.`;
}

async function generatePost(
  openrouterKey: string,
  systemPrompt: string,
  brief: Brief,
  related: string[],
): Promise<GeneratedPost> {
  const resp = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${openrouterKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": OPENROUTER_REFERER,
      "X-Title": OPENROUTER_TITLE,
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      response_format: { type: "json_object" },
      max_tokens: 8000,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: buildUserPrompt(brief, related) },
      ],
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`OpenRouter ${resp.status}: ${text.slice(0, 500)}`);
  }

  const data = await resp.json();
  const raw = data?.choices?.[0]?.message?.content;
  if (!raw) {
    const finishReason = data?.choices?.[0]?.finish_reason;
    const errMsg = data?.error?.message ?? JSON.stringify(data).slice(0, 300);
    throw new Error(`OpenRouter returned no content (finish_reason=${finishReason}): ${errMsg}`);
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(
      `JSON parse failed: ${e instanceof Error ? e.message : e}. First 500 chars: ${String(raw).slice(0, 500)}`,
    );
  }

  return {
    slug: brief.slug,
    title: String(parsed.title ?? brief.title),
    description: String(parsed.description ?? ""),
    category: String(parsed.category ?? brief.cluster ?? "Strategy"),
    cluster: brief.cluster,
    pageType: brief.pageType,
    content: String(parsed.content ?? ""),
    tableOfContents: (parsed.tableOfContents as GeneratedPost["tableOfContents"]) ?? [],
    relatedSlugs: related.slice(0, 5),
    keywords: (parsed.keywords as string[]) ?? [],
    ctaText: "Join ACA Community",
    wordCount: Number(parsed.wordCount ?? 0),
    readTime: String(parsed.readTime ?? "8 min read"),
    heroPrompt: String(parsed.heroPrompt ?? ""),
  };
}

// ── Hero image ───────────────────────────────────────────────────────────────

async function fireHeroPrediction(
  replicateToken: string,
  webhookSecret: string,
  slug: string,
  prompt: string,
): Promise<string | null> {
  if (!prompt) return null;
  const webhookUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/autoblog-image-webhook?slug=${encodeURIComponent(slug)}&secret=${encodeURIComponent(webhookSecret)}`;
  try {
    const resp = await fetch("https://api.replicate.com/v1/models/openai/gpt-image-2/predictions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${replicateToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        input: { prompt, number_of_images: 1, aspect_ratio: "3:2", quality: "high", output_format: "jpeg" },
        webhook: webhookUrl,
        webhook_events_filter: ["completed"],
      }),
    });
    if (!resp.ok) { console.warn(`Replicate hero ${resp.status}: ${await resp.text()}`); return null; }
    const data = await resp.json();
    return data.id as string;
  } catch (e) {
    console.warn(`Replicate hero fire failed: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

// ── Indexing pings ───────────────────────────────────────────────────────────

async function pingGoogleIndexing(serviceRoleKey: string, url: string): Promise<boolean> {
  try {
    const resp = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/google-indexing`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${serviceRoleKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url, type: "URL_UPDATED" }),
    });
    return resp.ok;
  } catch { return false; }
}

async function pingIndexNow(slug: string): Promise<boolean> {
  try {
    const resp = await fetch("https://api.indexnow.org/indexnow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        host: SITE_HOST,
        key: INDEXNOW_KEY,
        keyLocation: INDEXNOW_KEY_LOCATION,
        urlList: [`${SITE_BASE}/blog/${slug}`, `${SITE_BASE}/blog`, `${SITE_BASE}/sitemap.xml`],
      }),
    });
    return resp.ok || resp.status === 202;
  } catch { return false; }
}

// ── HTTP handler ─────────────────────────────────────────────────────────────

function jsonResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isAuthorized(req: Request): boolean {
  const auth = req.headers.get("Authorization");
  if (!auth) return false;
  const orchestratorSecret = Deno.env.get("ORCHESTRATOR_SECRET");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (orchestratorSecret && auth === `Bearer ${orchestratorSecret}`) return true;
  // The cron jobs send the vault service-role key. The anon key is public, so it
  // is never enough.
  if (serviceRoleKey && auth.includes(serviceRoleKey)) return true;
  return false;
}

interface PipelineArgs {
  briefs: Brief[];
  openrouterKey: string;
  notionKey: string;
  ghToken: string;
  replicateToken: string;
  webhookSecret: string;
  serviceRoleKey: string;
  // deno-lint-ignore no-explicit-any
  supabase: any;
  today: string;
}

async function runPipeline(args: PipelineArgs): Promise<void> {
  const { briefs, openrouterKey, notionKey, ghToken, replicateToken, webhookSecret, serviceRoleKey, supabase, today } = args;

  const ctx = await loadRunContext(ghToken);
  const systemPrompt = buildSystemPrompt(ctx);

  const generations = await Promise.allSettled(
    briefs.map(async (brief) => {
      const related = await pickRelatedSlugs(notionKey, brief.cluster, brief.slug);
      const post = await generatePost(openrouterKey, systemPrompt, brief, related);
      return { brief, post, related };
    }),
  );

  for (let i = 0; i < generations.length; i++) {
    const brief = briefs[i];
    const gen = generations[i];

    if (gen.status === "rejected") {
      const msg = gen.reason instanceof Error ? gen.reason.message : String(gen.reason);
      await revertBrief(notionKey, brief.pageId, `Generation failed: ${msg}`);
      continue;
    }

    const { post, related } = gen.value;

    try {
      const { data: dbRow, error: dbError } = await supabase
        .from("blog_posts")
        .upsert({
          slug: post.slug,
          title: post.title,
          description: post.description,
          content: {
            ...post,
            publishDate: today,
            modifiedDate: today,
            author: "Cedric Seguela",
            authorRole: "Founder, ACA",
            featured: false,
            ctaHref: CTA_HREF,
          },
          page_type: brief.pageType,
          cluster: brief.cluster,
          primary_keyword: brief.primaryKeyword,
          notion_page_id: brief.pageId,
          published_at: new Date().toISOString(),
        }, { onConflict: "slug" })
        .select("id")
        .single();

      if (dbError) throw new Error(`DB upsert failed: ${dbError.message}`);
      console.log(`[autoblog] DB upsert ok: ${post.slug} (${dbRow?.id})`);

      await fireHeroPrediction(replicateToken, webhookSecret, brief.slug, post.heroPrompt);

      const liveUrl = `${SITE_BASE}/blog/${brief.slug}`;
      const [google, indexNow] = await Promise.all([
        pingGoogleIndexing(serviceRoleKey, liveUrl),
        pingIndexNow(brief.slug),
      ]);

      const linksToRelations = await resolveLinksToRelations(notionKey, related);
      for (const rel of linksToRelations) await incrementInternalLinksIn(notionKey, rel.id);

      await notionUpdatePage(notionKey, brief.pageId, {
        "Status": { select: { name: "Published" } },
        "Created": { checkbox: true },
        "Publish Date": { date: { start: today } },
        "URL": { url: liveUrl },
        "Word Count": { number: post.wordCount },
        "Internal Links Out": { number: related.length },
        "Links To": { relation: linksToRelations },
        "Indexing Submitted": { checkbox: google && indexNow },
      });

      console.log(`[autoblog] Published: ${post.slug}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[autoblog] Failed: ${brief.slug} — ${msg}`);
      await revertBrief(notionKey, brief.pageId, msg);
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResp({ error: "POST only" }, 405);
  if (!isAuthorized(req)) return jsonResp({ error: "Unauthorized" }, 401);

  const openrouterKey = Deno.env.get("OPENROUTER_API_KEY");
  const notionKey = Deno.env.get("NOTION_API_KEY");
  const ghToken = Deno.env.get("GITHUB_TOKEN");
  const replicateToken = Deno.env.get("REPLICATE_API_TOKEN");
  const webhookSecret = Deno.env.get("AUTOBLOG_WEBHOOK_SECRET");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");

  const missing: string[] = [];
  if (!openrouterKey) missing.push("OPENROUTER_API_KEY");
  if (!notionKey) missing.push("NOTION_API_KEY");
  if (!ghToken) missing.push("GITHUB_TOKEN");
  if (!replicateToken) missing.push("REPLICATE_API_TOKEN");
  if (!webhookSecret) missing.push("AUTOBLOG_WEBHOOK_SECRET");
  if (!serviceRoleKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (missing.length) return jsonResp({ error: "Missing required secrets", missing }, 500);

  const supabase = createClient(supabaseUrl!, serviceRoleKey!);
  const today = new Date().toISOString().slice(0, 10);

  let briefs: Brief[];
  try {
    briefs = await pickBriefs(notionKey!);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonResp({ ok: false, error: msg }, 500);
  }
  if (briefs.length === 0) return jsonResp({ ok: true, message: "No briefs queued", outcomes: [] });

  for (const b of briefs) await lockBrief(notionKey!, b.pageId);

  // Generation takes 2-5 min per post — beyond the 150s idle timeout.
  // waitUntil lets the pipeline finish after the HTTP response is sent.
  // deno-lint-ignore no-explicit-any
  (globalThis as any).EdgeRuntime?.waitUntil(
    runPipeline({ briefs, openrouterKey: openrouterKey!, notionKey: notionKey!, ghToken: ghToken!, replicateToken: replicateToken!, webhookSecret: webhookSecret!, serviceRoleKey: serviceRoleKey!, supabase, today }),
  );

  return jsonResp({ ok: true, message: "Processing started", briefs: briefs.map((b) => b.slug) }, 202);
});
