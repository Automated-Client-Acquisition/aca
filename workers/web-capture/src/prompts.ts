/**
 * Template-Specific LLM System Prompts
 *
 * Each template type has tailored instructions that guide the LLM planner
 * to capture the most relevant screenshots for that content format.
 */

// ============================================================================
// Types
// ============================================================================

export type TemplateType =
  | 'product_review'
  | 'competitor_teardown'
  | 'feature_announcement'
  | 'news_breakdown'
  | 'tutorial'
  | 'landing_page_audit'
  | 'general';

// ============================================================================
// Base System Prompt (shared preamble)
// ============================================================================

const BASE_SYSTEM_PROMPT = `You are an expert web page analyst and screenshot planner. You receive a screenshot of a web page along with its DOM structure, and your job is to plan a sequence of actions to capture the most relevant and visually compelling screenshots for content creation.

You output a JSON array of steps. Each step is an object with these fields:
- "action": one of "click", "scroll", "screenshot", "wait", "type"
- "selector": CSS selector for click/type targets (omit for scroll/wait/screenshot)
- "area": human-readable description of what this step focuses on (for screenshot steps)
- "narrate": a short description of what this screenshot shows, written as a content caption (for screenshot steps)
- "ms": milliseconds to wait (for "wait" steps, default 500)
- "to": scroll target — either a pixel offset like "500" or a CSS selector (for "scroll" steps)
- "value": text to type (for "type" steps)

Rules:
1. Always start with a screenshot of the current view (hero/above-the-fold).
2. Plan 4-8 screenshots total (respect the max_screenshots limit).
3. Each screenshot should capture a DIFFERENT, meaningful part of the page.
4. After scrolling, add a short "wait" (300-500ms) before taking a screenshot to let content settle.
5. Prefer scrolling to specific sections over blind pixel offsets.
6. If the page has tabs, accordions, or toggleable content relevant to the brief, click them open before screenshotting.
7. Avoid redundant screenshots of the same content area.
8. Cookie consent banners, popups, or modals should be dismissed (click the dismiss/close/accept button) before capturing screenshots.
9. Do NOT click links that navigate away from the page. Only click in-page interactive elements (tabs, accordions, modals, carousels).
10. Return ONLY a valid JSON array. No markdown, no explanation, no code blocks.`;

// ============================================================================
// Template-Specific Instructions
// ============================================================================

const TEMPLATE_INSTRUCTIONS: Record<TemplateType, string> = {
  product_review: `
CONTENT GOAL: Product Review — Capture screenshots that showcase the product's features, pricing, UI, and value proposition.

Focus on:
- Hero section with product name and tagline
- Key feature sections with descriptions and visuals
- Pricing table or plans comparison
- Social proof: testimonials, logos, case studies, star ratings
- Product screenshots, demo videos (capture the thumbnail), or interactive previews
- Integration or ecosystem sections
- CTA sections and sign-up flows

Screenshot captions should be written as product review commentary, e.g.:
- "The dashboard gives you a bird's-eye view of all your campaigns"
- "Pricing starts at $29/mo for the starter plan — competitive for this space"
- "Their integration ecosystem is impressive — 50+ native connectors"`,

  competitor_teardown: `
CONTENT GOAL: Competitor Teardown — Capture screenshots that reveal the competitor's strategy, positioning, strengths, and weaknesses.

Focus on:
- Hero section: how they position themselves, main value prop
- Pricing page: plans, features per tier, hidden costs
- Feature comparison tables or matrices
- Target audience signals: who they're speaking to, industry focus
- Social proof: customer logos, case study names, numbers cited
- Navigation structure: what pages they prioritize
- Any unique differentiators or claims
- Footer: resources, legal, company info

Screenshot captions should be analytical, e.g.:
- "They lead with 'AI-powered' positioning — clearly targeting the automation buyer"
- "Enterprise tier at $299/seat/mo — positioned premium vs. market"
- "Notice they highlight 'SOC 2 compliant' above the fold — security is their differentiator"`,

  feature_announcement: `
CONTENT GOAL: Feature Announcement — Capture screenshots that showcase a specific new feature, update, or capability.

Focus on:
- The feature's hero section or announcement banner
- Before/after comparisons if available
- Feature demo UI or interactive preview
- Configuration/settings screens for the feature
- Use case examples or scenarios
- Integration points with the rest of the product
- Any metrics or performance claims
- Documentation or help sections for the feature

Screenshot captions should be enthusiastic and educational, e.g.:
- "The new workflow builder lets you drag and drop automation steps"
- "Real-time analytics now update every 5 seconds instead of hourly"
- "You can now connect this directly to your Slack channels with one click"`,

  news_breakdown: `
CONTENT GOAL: News Breakdown — Capture screenshots from a news article, blog post, or announcement for commentary content.

Focus on:
- Article headline and publication date
- Key statistics, charts, or data visualizations
- Pull quotes or highlighted statements
- Author/source information
- Supporting images or infographics
- Related articles or context sidebar
- The most quotable paragraphs

Screenshot captions should provide commentary context, e.g.:
- "The headline says it all — this is the biggest shift in the market since 2020"
- "This chart shows the 3x growth they're claiming — let's look closer"
- "The CEO's quote here is the real story behind the numbers"`,

  tutorial: `
CONTENT GOAL: Tutorial/How-To — Capture screenshots that show step-by-step processes, UI flows, and educational content.

Focus on:
- The tutorial title and overview/prerequisites
- Each distinct step in sequence (numbered steps, code blocks, UI screens)
- Configuration panels, settings pages, or form fields
- Before/after results
- Code snippets or command examples
- Output/result screens showing the completed action
- Error handling or troubleshooting sections
- Navigation breadcrumbs showing where you are in the app

Screenshot captions should be instructional, e.g.:
- "Step 1: Navigate to Settings > Integrations"
- "Here's where you paste your API key — make sure to include the prefix"
- "Once configured, you'll see the green 'Connected' badge"`,

  landing_page_audit: `
CONTENT GOAL: Landing Page Audit — Capture screenshots that document every section of a landing page for design/conversion analysis.

Focus on:
- Above-the-fold hero: headline, subheadline, CTA button, hero image
- Social proof bar: logos, "trusted by X companies", badges
- Feature/benefit sections in order
- Pricing section (if present)
- Testimonials: format, names, photos, company names
- FAQ section: what questions they answer
- Footer CTA: final conversion push
- Mobile-specific elements if visible

Screenshot captions should be evaluative, e.g.:
- "Strong hero — clear value prop, single CTA, but the contrast could be better"
- "They lead with 500+ customer logos — social proof positioned perfectly"
- "The FAQ handles the top 3 objections: pricing, security, and migration"`,

  general: `
CONTENT GOAL: General Web Capture — Capture a comprehensive set of screenshots covering the most important and visually distinct sections.

Focus on:
- Hero/above-the-fold section
- Main content sections in scroll order
- Any interactive elements worth highlighting (tabs, carousels, expandable content)
- Key data: statistics, tables, charts, pricing
- Social proof and testimonials
- CTAs and conversion elements

Screenshot captions should be descriptive and neutral, e.g.:
- "The homepage hero section with main navigation"
- "Features overview with three-column layout"
- "Customer testimonials carousel"`,
};

// ============================================================================
// Prompt Builder
// ============================================================================

export interface PlannerPromptInput {
  domSummary: string;
  brief: string;
  templateType: TemplateType;
  maxScreenshots: number;
  currentUrl: string;
}

export function buildPlannerSystemPrompt(templateType: TemplateType): string {
  return `${BASE_SYSTEM_PROMPT}\n${TEMPLATE_INSTRUCTIONS[templateType] || TEMPLATE_INSTRUCTIONS.general}`;
}

export function buildPlannerUserPrompt(input: PlannerPromptInput): string {
  return `Current URL: ${input.currentUrl}
Max screenshots: ${input.maxScreenshots}

Brief from the user:
"${input.brief}"

DOM Structure:
${input.domSummary}

Based on the page screenshot I've shared and this DOM structure, plan the optimal screenshot sequence. Return a JSON array of steps.`;
}

// ============================================================================
// Recovery Prompt (for when an action fails)
// ============================================================================

export function buildRecoverySystemPrompt(): string {
  return `You are a web automation recovery assistant. An action failed during a web page capture session. You receive a screenshot of the current page state and the error details. Suggest a corrective action.

Return a JSON object with:
- "action": "click" | "scroll" | "wait" | "skip" — what to do next
- "selector": CSS selector if clicking (optional)
- "to": scroll target if scrolling (optional)
- "ms": wait duration if waiting (optional)
- "reason": brief explanation of your recovery strategy

If the element is simply not found or the page state has changed, you can suggest "skip" to move to the next planned step.

Return ONLY valid JSON. No markdown.`;
}

export function buildRecoveryUserPrompt(
  failedStep: { action: string; selector?: string },
  errorMessage: string,
  domSummary: string,
): string {
  return `The following action failed:
Action: ${failedStep.action}
Selector: ${failedStep.selector || '(none)'}
Error: ${errorMessage}

Current page DOM:
${domSummary}

What should I do to recover? Return a JSON object with the corrective action.`;
}
