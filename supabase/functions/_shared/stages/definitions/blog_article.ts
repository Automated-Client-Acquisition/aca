/**
 * Blog Article Pipeline Stage Definitions
 *
 * Defines all stages for the blog_article pipeline:
 * 1. outline - Generate article outline/structure
 * 2. article - Generate full article content
 * 3. hero_image - Generate hero/featured image
 */

import type { StageDefinition } from '../../execution/types.ts';
import { StageRegistry, defineStage } from '../../execution/StageRegistry.ts';
import { DEFAULT_FREE_TEXT_MODEL, DEFAULT_IMAGE_MODEL, DEFAULT_TEXT_STAGE_MAX_TOKENS } from '../../default-models.ts';

// ============= OUTLINE STAGE =============

export const OUTLINE_STAGE = defineStage({
  id: 'outline',
  type: 'text',
  provider: 'openrouter',
  requires: {
    libraryElements: ['brandVoice'],
    contextFields: ['ideaContext'],
  },
  promptTemplate: {
    system: `You are creating an outline for a blog article. Generate a structured outline that will serve as the foundation for the full article.

Requirements:
- Create a compelling title
- 5-8 main sections with clear headings
- Brief description of what each section will cover
- Include intro and conclusion
- Consider SEO-friendly structure
{{#brandVoice.tone}}- Tone: {{brandVoice.tone}}{{/brandVoice.tone}}
{{#brandVoice.writingStyle}}- Writing style: {{brandVoice.writingStyle}}{{/brandVoice.writingStyle}}

Output format - JSON:
{
  "title": "Article Title",
  "meta_description": "SEO meta description (150-160 chars)",
  "sections": [
    {
      "heading": "Introduction",
      "key_points": ["point 1", "point 2"]
    },
    {
      "heading": "Section Title",
      "key_points": ["point 1", "point 2", "point 3"]
    },
    ...
    {
      "heading": "Conclusion",
      "key_points": ["summary point", "call to action"]
    }
  ]
}

Return ONLY the JSON object.`,
    user: `Create an outline for a blog article about:

{{ideaContext}}

{{#searchTerm.term}}Target keyword: {{searchTerm.term}}{{/searchTerm.term}}
{{#icp.name}}Target audience: {{icp.name}}{{/icp.name}}`,
  },
  providerConfig: {
    model: DEFAULT_FREE_TEXT_MODEL,
    temperature: 0.7,
    // Output ceiling, not a length limit: room for a reasoning model to think.
    maxTokens: DEFAULT_TEXT_STAGE_MAX_TOKENS,
  },
  outputTransform: 'parseOutlineContent',
});

// ============= ARTICLE STAGE =============

export const ARTICLE_STAGE = defineStage({
  id: 'article',
  type: 'text',
  provider: 'openrouter',
  requires: {
    previousStages: ['outline'],
    libraryElements: ['brandVoice', 'product'],
    contextFields: ['ideaContext', 'masterPrompt'],
  },
  promptTemplate: {
    system: `You are writing a blog article based on the provided outline.

Follow the outline structure. Use markdown formatting (## for H2, ### for H3).
{{#brandVoice.tone}}
Tone: {{brandVoice.tone}}{{/brandVoice.tone}}
{{#brandVoice.writingStyle}}
Style: {{brandVoice.writingStyle}}{{/brandVoice.writingStyle}}
{{#brandVoice.vocabulary}}
Vocabulary: {{brandVoice.vocabulary}}{{/brandVoice.vocabulary}}

{{#product.name}}The product "{{product.name}}" can be mentioned where relevant.{{/product.name}}

Output ONLY the article content in markdown format.`,
    user: `Write a blog article following this outline:

{{previousStageOutputs.outline.content}}

Topic: {{ideaContext}}

{{#masterPrompt}}{{masterPrompt}}{{/masterPrompt}}`,
  },
  providerConfig: {
    model: DEFAULT_FREE_TEXT_MODEL,
    temperature: 0.7,
    // A whole article in one call (outlines of 6+ sections go per section), plus
    // a reasoning model's thinking. Was unset, which made OpenRouter reserve
    // credit for the model's entire output ceiling.
    maxTokens: 16000,
  },
});

// ============= HERO IMAGE STAGE =============

export const HERO_IMAGE_STAGE = defineStage({
  id: 'hero_image',
  type: 'image',
  provider: 'replicate',
  requires: {
    previousStages: ['outline'],
    libraryElements: ['brandVoice'],
    contextFields: ['ideaContext'],
  },
  providerConfig: {
    model: DEFAULT_IMAGE_MODEL,
    aspectRatio: '16:9', // Landscape for blog hero
    useReferenceImage: false, // Blog images usually don't need character consistency
  },
  customHandler: 'executeHeroImageStage', // Uses LLM to generate image prompt from outline
  isAsync: true,
});

// ============= REGISTER ALL STAGES =============

export function registerBlogArticleStages(): void {
  StageRegistry.register('blog_article', OUTLINE_STAGE);
  StageRegistry.register('blog_article', ARTICLE_STAGE);
  StageRegistry.register('blog_article', HERO_IMAGE_STAGE);

  console.log('[StageDefinitions] Registered blog_article stages');
}

// Auto-register on import
registerBlogArticleStages();

export default {
  OUTLINE_STAGE,
  ARTICLE_STAGE,
  HERO_IMAGE_STAGE,
};
