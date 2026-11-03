/**
 * The LinkedIn blueprint seeded into every playbook workspace.
 *
 * A copy of the "LinkedIn Post" starter (`starter-linkedin-post` in
 * src/data/starterPackBlueprints.ts), which edge functions can't import. It
 * gives the row everything /create needs to run it: a pipeline, prompts,
 * input slots and models. Without an image_generator a social_media_post job
 * fails at the image stage, so model_config is not optional.
 *
 * Used by provision-playbook-workspace (insert) and generate-playbook-artifacts
 * (which later renames the row and adds structure.themes). The backfill in
 * supabase/migrations/20260925120000_backfill_playbook_linkedin_blueprints.sql
 * repeats these values in SQL — change them together.
 */

const MASTER_PROMPT = `Write a LinkedIn post that stops the scroll and drives engagement.

TOPIC: {{topic}}

{{ai_talking_points_list}}

STRUCTURE:
1. **HOOK** (First line - this shows in the feed preview)
   - Pattern interrupt or bold statement
   - Makes people click "see more"
   - No fluff, no "I'm excited to share..."

2. **BODY** (3-5 short paragraphs)
   - One idea per paragraph
   - Use line breaks for readability
   - Include a specific story, example, or data point
   - Write like you talk - conversational, not corporate
   - Weave in the key messages naturally if provided

3. **TAKEAWAY** (The "so what")
   - Clear lesson or insight
   - Actionable if possible

4. **CTA** (Engagement driver)
   - Ask a specific question
   - Invite comments with a low-friction prompt

Keep it under 200 words. No hashtags in the body - add 3-5 relevant hashtags at the very end after a line break.`;

const IMAGE_PROMPT = `Professional, clean LinkedIn-style image for a post about: {{topic}}

Style: Modern, minimal, professional aesthetic
- Clean background (subtle gradient or solid)
- If text overlay: bold, readable sans-serif font
- Professional color palette (blues, whites, subtle accents)
- NO stock photo feel - should look native to LinkedIn
- 1:1 aspect ratio optimized for LinkedIn feed`;

export function playbookLinkedInBlueprintName(niche?: string | null): string {
  return `${niche || "Daily"} · LinkedIn blueprint`;
}

/** The runnable columns. A fresh object each call, safe to spread and mutate. */
export function playbookLinkedInBlueprintFields() {
  return {
    pipeline: "social_media_post",
    master_prompt: MASTER_PROMPT,
    image_prompt: IMAGE_PROMPT,
    skip_image_generation: false,
    structure: {
      slots: [
        { key: "topic", type: "text", label: "What is your post about?", required: true },
        { key: "ai_talking_points_list", type: "text", label: "Key messages to include (optional)", required: false },
      ],
    } as Record<string, unknown>,
    model_config: {
      text_llm: {
        provider: "openrouter",
        model_id: "anthropic/claude-sonnet-4.5",
        parameters: { temperature: 0.7, max_tokens: 4096 },
      },
      image_generator: {
        provider: "openrouter",
        model_id: "openai/gpt-5-image",
        parameters: { aspect_ratio: "1:1" },
      },
    } as Record<string, unknown>,
    tags: ["linkedin", "post", "social-media", "engagement", "from_playbook"],
    // The app hides inactive blueprints everywhere (/blueprints, /create), and
    // a blueprint only runs when someone picks it, so there's nothing to gate.
    is_active: true,
  };
}
