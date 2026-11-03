// Blueprint Starter Pack - Pre-configured, best-in-class templates
// Designed for minimal input with maximum output quality
// Free for all users, locked for $1 plan (free tier)

import type { PipelineId } from '@/types/pipeline';
import type { BlueprintModelConfig, BlueprintStructure } from '@/types/blueprint';

// =============================================================================
// BEST-IN-CLASS MODEL CONFIGURATIONS
// =============================================================================

const MODELS = {
  // Text LLM - Claude Sonnet 4.5 (best reasoning + writing)
  SONNET_4_5: {
    provider: 'openrouter' as const,
    model_id: 'anthropic/claude-sonnet-4.5',
    parameters: {
      temperature: 0.7,
      max_tokens: 4096,
    },
  },

  // Image Generator - Nano Banana Pro (Gemini 3 Pro Image Preview via OpenRouter)
  FLUX_1_1_PRO: {
    provider: 'openrouter' as const,
    model_id: 'google/gemini-3.1-flash-image-preview',
    parameters: {
      aspect_ratio: '1:1',
    },
  },

  // Image Generator - GPT-5 Image (best-in-class text rendering for social posts with overlays)
  GPT_IMAGE_1: {
    provider: 'openrouter' as const,
    model_id: 'openai/gpt-5-image',
    parameters: {
      aspect_ratio: '1:1',
    },
  },

  // World Simulator - Veo 3.1 (best T2V quality)
  VEO_3_1: {
    provider: 'replicate' as const,
    model_id: 'google/veo-3.1',
    parameters: {
      duration: 5,
      aspect_ratio: '16:9',
    },
  },

};

// =============================================================================
// STARTER PACK BLUEPRINT INTERFACE
// =============================================================================

export interface StarterPackBlueprint {
  id: string;
  name: string;
  description: string;
  category: 'linkedin' | 'instagram' | 'blog' | 'image_only' | 'video' | 'video_script' | 'video_generation' | 'video_remix' | 'presenter_video';
  pipeline: PipelineId;
  master_prompt: string;
  image_prompt?: string;
  director_prompt?: string;
  structure: BlueprintStructure;
  model_config: BlueprintModelConfig;
  tags: string[];
  difficulty: 'beginner' | 'intermediate';
  estimated_time: string; // e.g., "30 seconds", "2 minutes"
  preview_image?: string; // URL to example output
}

// =============================================================================
// LINKEDIN BLUEPRINTS
// =============================================================================

export const linkedinBlueprints: StarterPackBlueprint[] = [
  {
    id: 'starter-linkedin-comment-strategy',
    name: 'LinkedIn Comment Strategy',
    description: 'Generate strategic comments + talking points to engage on LinkedIn and build authority',
    category: 'linkedin',
    pipeline: 'rich_article',
    master_prompt: `You are a LinkedIn engagement strategist. Generate a complete engagement toolkit for someone in the {{topic}} space.

{{ai_talking_points_list}}

---

## PART 1: YOUR AUTHORITY TALKING POINTS

Generate 6 key talking points that position you as an expert in {{topic}}. These are ideas/opinions you can reference across multiple comments and posts:

1. **Contrarian Take:** [An opinion that challenges conventional wisdom]
2. **Data-Backed Insight:** [A specific stat or trend you can cite]
3. **Framework/Model:** [A simple framework you've developed or use]
4. **Common Mistake:** [What most people get wrong]
5. **Prediction:** [Where you see the industry heading]
6. **Personal Principle:** [A core belief that guides your approach]

---

## PART 2: COMMENT TEMPLATES

Create 5 ready-to-use comment templates. Each should subtly incorporate your talking points where relevant.

### 1. AGREEMENT + INSIGHT
[Start with brief agreement, then add YOUR unique perspective or example]

**Template:**
[Ready-to-use comment - 2-3 sentences]

💡 **Use when:** [Type of posts this works for]
🎯 **Talking point it reinforces:** [Which of your talking points this echoes]

---

### 2. RESPECTFUL COUNTER-POINT
[Challenge constructively while positioning your expertise]

**Template:**
[Ready-to-use comment]

💡 **Use when:** [Guidance]
🎯 **Talking point it reinforces:** [Reference]

---

### 3. PERSONAL EXPERIENCE
[Share a story that demonstrates your expertise]

**Template:**
[Ready-to-use comment]

💡 **Use when:** [Guidance]
🎯 **Talking point it reinforces:** [Reference]

---

### 4. EXPERT QUESTION
[Ask something that shows deep understanding]

**Template:**
[Ready-to-use comment]

💡 **Use when:** [Guidance]
🎯 **Talking point it reinforces:** [Reference]

---

### 5. VALUE-ADD RESOURCE
[Share a framework, tool, or insight]

**Template:**
[Ready-to-use comment]

💡 **Use when:** [Guidance]
🎯 **Talking point it reinforces:** [Reference]

---

## PART 3: ENGAGEMENT GAME PLAN

**Daily routine (15 min/day):**
1. [Specific action with timing]
2. [Specific action]
3. [Specific action]

**Accounts to engage with:**
- [Type of account 1] - why they're valuable
- [Type of account 2] - why they're valuable
- [Type of account 3] - why they're valuable

**Hashtags to follow:**
[3-5 relevant hashtags for {{topic}}]`,
    structure: {
      slots: [
        {
          key: 'topic',
          type: 'text',
          label: 'Your niche or industry',
          required: true,
        },
        {
          key: 'ai_talking_points_list',
          type: 'text',
          label: 'Key talking points to weave in (optional - leave blank to generate)',
          required: false,
        },
      ],
    },
    model_config: {
      text_llm: MODELS.SONNET_4_5,
    },
    tags: ['linkedin', 'engagement', 'comments', 'networking', 'authority', 'talking-points'],
    difficulty: 'beginner',
    estimated_time: '45 seconds',
  },
  {
    // Copied into supabase/functions/_shared/playbook-linkedin-blueprint.ts
    // (the blueprint seeded into playbook workspaces); its test fails on drift.
    id: 'starter-linkedin-post',
    name: 'LinkedIn Post',
    description: 'Create a high-engagement LinkedIn post with hook, story, and CTA',
    category: 'linkedin',
    pipeline: 'social_media_post',
    master_prompt: `Write a LinkedIn post that stops the scroll and drives engagement.

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

Keep it under 200 words. No hashtags in the body - add 3-5 relevant hashtags at the very end after a line break.`,
    image_prompt: `Professional, clean LinkedIn-style image for a post about: {{topic}}

Style: Modern, minimal, professional aesthetic
- Clean background (subtle gradient or solid)
- If text overlay: bold, readable sans-serif font
- Professional color palette (blues, whites, subtle accents)
- NO stock photo feel - should look native to LinkedIn
- 1:1 aspect ratio optimized for LinkedIn feed`,
    structure: {
      slots: [
        {
          key: 'topic',
          type: 'text',
          label: 'What is your post about?',
          required: true,
        },
        {
          key: 'ai_talking_points_list',
          type: 'text',
          label: 'Key messages to include (optional)',
          required: false,
        },
      ],
    },
    model_config: {
      text_llm: MODELS.SONNET_4_5,
      image_generator: MODELS.GPT_IMAGE_1,
    },
    tags: ['linkedin', 'post', 'social-media', 'engagement'],
    difficulty: 'beginner',
    estimated_time: '45 seconds',
  },
  {
    id: 'starter-linkedin-carousel-ideas',
    name: 'LinkedIn Carousel Ideas',
    description: 'Generate 5 carousel post concepts with slide breakdowns',
    category: 'linkedin',
    pipeline: 'rich_article',
    master_prompt: `Generate 5 LinkedIn carousel post ideas for someone in the {{topic}} space.

For each idea, provide:

## CAROUSEL [NUMBER]: [CATCHY TITLE]

**Hook Slide:** [Attention-grabbing first slide text - max 10 words]

**Slide Breakdown:**
- Slide 2: [Content]
- Slide 3: [Content]
- Slide 4: [Content]
- Slide 5: [Content]
- Slide 6: [CTA slide]

**Why it works:** [1 sentence on the psychology/engagement driver]

---

Make each carousel:
- Educational or contrarian
- Specific (not generic advice)
- Swipe-worthy (creates curiosity between slides)
- End with clear CTA

Carousel types to include:
1. "X mistakes" or "X myths"
2. Step-by-step framework
3. Before/After or Then/Now
4. Contrarian take with evidence
5. Lessons learned from experience`,
    structure: {
      slots: [
        {
          key: 'topic',
          type: 'text',
          label: 'Your niche or expertise',
          required: true,
        },
      ],
    },
    model_config: {
      text_llm: MODELS.SONNET_4_5,
    },
    tags: ['linkedin', 'carousel', 'ideas', 'content-planning'],
    difficulty: 'beginner',
    estimated_time: '30 seconds',
  },
];

// =============================================================================
// INSTAGRAM BLUEPRINTS
// =============================================================================

export const instagramBlueprints: StarterPackBlueprint[] = [
  {
    id: 'starter-instagram-post',
    name: 'Instagram Post',
    description: 'Eye-catching image with engaging caption and hashtags',
    category: 'instagram',
    pipeline: 'social_media_post',
    master_prompt: `Write an Instagram caption that drives engagement.

TOPIC: {{topic}}

STRUCTURE:
1. **HOOK** (First line)
   - Emoji or attention-grabber
   - Makes people tap "more"

2. **BODY** (2-3 short paragraphs)
   - Tell a mini-story or share insight
   - Personal and relatable
   - Use emojis naturally (not overdone)

3. **CTA**
   - Ask a question or invite action
   - "Double tap if..." or "Drop a [emoji] if..."

4. **HASHTAGS** (After line breaks)
   - 5-10 relevant hashtags
   - Mix of sizes: 2 big (1M+), 3 medium (100K-1M), 3 small (<100K niche)

Keep the caption under 150 words. Authentic voice, not salesy.`,
    image_prompt: `Stunning, scroll-stopping Instagram image about: {{topic}}

Style requirements:
- Vibrant, high-contrast colors
- Clean composition with clear focal point
- Instagram-native aesthetic (not stock photo)
- 1:1 square format
- Modern, trendy visual style
- If lifestyle: aspirational but authentic
- If product: clean, minimal background
- Professional lighting and quality`,
    structure: {
      slots: [
        {
          key: 'topic',
          type: 'text',
          label: 'Post topic or theme',
          required: true,
        },
      ],
    },
    model_config: {
      text_llm: MODELS.SONNET_4_5,
      image_generator: MODELS.GPT_IMAGE_1,
    },
    tags: ['instagram', 'post', 'social-media', 'visual'],
    difficulty: 'beginner',
    estimated_time: '45 seconds',
  },
];

// =============================================================================
// VIDEO SCRIPT BLUEPRINTS
// =============================================================================

export const videoScriptBlueprints: StarterPackBlueprint[] = [
  {
    id: 'starter-youtube-script',
    name: 'YouTube Video Script',
    description: 'Full YouTube script with hook, timestamps, and SEO optimization',
    category: 'video_script',
    pipeline: 'video_script',
    master_prompt: `Write a YouTube video script.

TOPIC: {{topic}}
TARGET LENGTH: {{duration}} minutes

{{ai_talking_points_list}}

## VIDEO STRUCTURE

### HOOK (0:00 - 0:30)
[Open with a bold claim, question, or pattern interrupt. No "Hey guys, welcome back..." - get straight to the value.]

**Script:**
[Exact words to say]

---

### INTRO (0:30 - 1:00)
[Brief context on what they'll learn and why it matters. Build credibility quickly.]

**Script:**
[Exact words]

---

### MAIN CONTENT
[Break into clear sections with timestamps. Ensure each key talking point gets covered in a dedicated section if provided.]

#### Section 1: [Title] (1:00 - X:XX)
**Key Point:** [One sentence summary]

**Script:**
[Detailed script for this section]

[Repeat for each section - create enough sections to cover all talking points]

---

### CONCLUSION (Last 1-2 minutes)
**Recap:** [Quick summary of key points - reinforce the main talking points if provided]
**CTA:** [Subscribe, comment, next video tease]

**Script:**
[Exact closing words]

---

## THUMBNAIL CONCEPTS
1. [Concept with text overlay suggestion]
2. [Alternative concept]

## TITLE OPTIONS
1. [Click-worthy title option]
2. [Alternative]
3. [Alternative]

## DESCRIPTION
[SEO-optimized description with timestamps]`,
    structure: {
      slots: [
        {
          key: 'topic',
          type: 'text',
          label: 'Video topic',
          required: true,
        },
        {
          key: 'duration',
          type: 'text',
          label: 'Target length (minutes)',
          required: false,
        },
        {
          key: 'ai_talking_points_list',
          type: 'text',
          label: 'Key points to cover (optional)',
          required: false,
        },
      ],
    },
    model_config: {
      text_llm: MODELS.SONNET_4_5,
    },
    tags: ['youtube', 'script', 'video', 'long-form'],
    difficulty: 'intermediate',
    estimated_time: '2 minutes',
  },
  {
    id: 'starter-tiktok-script',
    name: 'TikTok/Shorts Script',
    description: 'Viral short-form script optimized for TikTok and YouTube Shorts',
    category: 'video_script',
    pipeline: 'video_script',
    master_prompt: `Write a viral TikTok/Shorts script (15-60 seconds).

TOPIC: {{topic}}

## THE HOOK (First 1-2 seconds)
[This determines if people keep watching. Pattern interrupt required.]

**Visual:** [What's on screen immediately]
**Audio:** [First words or sound]
**Text overlay:** [On-screen text if any]

---

## THE BODY (Middle section)

**Beat 1 (3-5 sec):**
Visual:
Says:
Text:

**Beat 2 (3-5 sec):**
Visual:
Says:
Text:

**Beat 3 (3-5 sec):**
Visual:
Says:
Text:

---

## THE PAYOFF (Last 2-3 seconds)
[Satisfying conclusion, twist, or CTA]

Visual:
Says:
Text:

---

## POSTING DETAILS

**Caption:** [Short, punchy, with 1-2 relevant hashtags]

**Best posting time:** [Suggestion based on content type]

**Hook variations to test:**
1. [Alternative hook]
2. [Alternative hook]

---

STYLE NOTES:
- Fast pace, no dead air
- Each beat should feel like it could be its own video
- End strong - this determines shares
- Speak conversationally, not scripted-sounding`,
    structure: {
      slots: [
        {
          key: 'topic',
          type: 'text',
          label: 'Video topic or message',
          required: true,
        },
      ],
    },
    model_config: {
      text_llm: MODELS.SONNET_4_5,
    },
    tags: ['tiktok', 'shorts', 'script', 'short-form', 'viral'],
    difficulty: 'beginner',
    estimated_time: '30 seconds',
  },
];

// =============================================================================
// BLOG/ARTICLE BLUEPRINTS
// =============================================================================

export const blogBlueprints: StarterPackBlueprint[] = [
  {
    id: 'starter-seo-blog-post',
    name: 'SEO Blog Post',
    description: 'Search-optimized blog article with proper structure and internal linking suggestions',
    category: 'blog',
    pipeline: 'rich_article',
    master_prompt: `Write an SEO-optimized blog post.

TOPIC: {{topic}}
TARGET KEYWORD: {{keyword}}

{{ai_talking_points_list}}

## ARTICLE STRUCTURE

### Title
[H1 - Include primary keyword naturally, under 60 characters]

### Meta Description
[155 characters max, includes keyword, compelling click-driver]

---

### Introduction (100-150 words)
- Hook the reader immediately
- State the problem or question
- Preview what they'll learn
- Include primary keyword in first 100 words

---

### Main Content (1200-1500 words)
[Structure sections around the key talking points provided if any]

#### [H2: First Major Section]
[Content with subheadings H3 if needed]

#### [H2: Second Major Section]
[Content]

#### [H2: Third Major Section]
[Content]

[Continue as needed - aim for 4-6 H2 sections, covering all talking points]

---

### Conclusion (100 words)
- Summarize key points
- Clear next step or CTA
- End with a question to encourage comments

---

## SEO CHECKLIST
- [ ] Primary keyword in: Title, H1, first 100 words, 1-2 H2s, conclusion
- [ ] Secondary keywords woven naturally throughout
- [ ] Internal linking opportunities: [Suggest 2-3 related topics to link to]
- [ ] External linking: [1-2 authoritative sources to reference]

## FEATURED IMAGE SUGGESTION
[Description of ideal header image]`,
    image_prompt: `Professional blog header image for article about: {{topic}}

Style:
- Clean, modern design
- Subtle relevant imagery or abstract visualization
- Space for text overlay if needed
- Professional color palette
- 16:9 aspect ratio for featured image
- High quality, not generic stock photo`,
    structure: {
      slots: [
        {
          key: 'topic',
          type: 'text',
          label: 'Blog topic',
          required: true,
        },
        {
          key: 'keyword',
          type: 'text',
          label: 'Target SEO keyword',
          required: false,
        },
        {
          key: 'ai_talking_points_list',
          type: 'text',
          label: 'Key points to cover (optional)',
          required: false,
        },
      ],
    },
    model_config: {
      text_llm: MODELS.SONNET_4_5,
      image_generator: {
        ...MODELS.FLUX_1_1_PRO,
        parameters: {
          ...MODELS.FLUX_1_1_PRO.parameters,
          aspect_ratio: '16:9',
        },
      },
    },
    tags: ['blog', 'seo', 'article', 'content-marketing'],
    difficulty: 'intermediate',
    estimated_time: '2 minutes',
  },
  {
    id: 'starter-newsletter',
    name: 'Newsletter Issue',
    description: 'Engaging email newsletter with clear sections and strong CTA',
    category: 'blog',
    pipeline: 'rich_article',
    master_prompt: `Write an engaging newsletter issue.

TOPIC: {{topic}}

## NEWSLETTER STRUCTURE

### Subject Line Options
1. [Curiosity-driven option]
2. [Benefit-driven option]
3. [Urgency/FOMO option]

### Preview Text
[40-90 characters that complement subject line]

---

### Opening Hook
[2-3 sentences that make them want to keep reading. Personal, timely, or contrarian.]

---

### Main Content

#### The Big Idea
[One core insight, story, or lesson - this is the meat of the newsletter]

[Write 300-400 words of valuable content]

#### Key Takeaways
- [Takeaway 1]
- [Takeaway 2]
- [Takeaway 3]

---

### Quick Hits (Optional section)
[2-3 bullet points of additional value - links, resources, quick tips]

---

### CTA Section
[Clear call to action - reply, click, share, buy]

---

### Sign-off
[Brief, warm closing]

[Your name]

P.S. [Optional hook for next issue or secondary CTA]

---

FORMATTING NOTES:
- Short paragraphs (2-3 sentences max)
- Use bold for key phrases
- Include 1-2 relevant emojis if on-brand
- Mobile-first: assume they're reading on phone`,
    structure: {
      slots: [
        {
          key: 'topic',
          type: 'text',
          label: 'Newsletter topic or theme',
          required: true,
        },
      ],
    },
    model_config: {
      text_llm: MODELS.SONNET_4_5,
    },
    tags: ['newsletter', 'email', 'content-marketing'],
    difficulty: 'beginner',
    estimated_time: '1 minute',
  },
  {
    id: 'starter-twitter-thread',
    name: 'X/Twitter Thread',
    description: 'Viral thread with strong hook and engagement drivers',
    category: 'blog',
    pipeline: 'rich_article',
    master_prompt: `Write a viral X/Twitter thread.

TOPIC: {{topic}}

## THREAD STRUCTURE (8-12 tweets)

### Tweet 1 (THE HOOK)
[This tweet determines everything. Bold claim, surprising stat, or pattern interrupt. End with "🧵" or "Thread:"]

---

### Tweet 2
[Expand on the hook. Build credibility or context.]

---

### Tweet 3-7 (THE MEAT)
[Each tweet = one complete idea. Use this pattern:]

Tweet 3: [Point 1]

Tweet 4: [Point 2]

Tweet 5: [Point 3]

Tweet 6: [Point 4 - often the best/most surprising point]

Tweet 7: [The twist, story, or deeper insight]

---

### Tweet 8 (THE TAKEAWAY)
[Summarize the key lesson. Make it quotable/screenshotable.]

---

### Tweet 9 (THE CTA)
[Drive engagement: "If you found this valuable..." or "Follow for more..." Include repost request]

---

## FORMATTING RULES:
- Each tweet under 280 characters
- Line breaks for readability
- Emojis: 1-2 per tweet max, strategic placement
- No hashtags in body (optional 1-2 at very end)
- Number threads: 1/, 2/, etc. OR use 🧵

## HOOK VARIATIONS TO TEST:
1. [Alternative hook]
2. [Alternative hook]`,
    structure: {
      slots: [
        {
          key: 'topic',
          type: 'text',
          label: 'Thread topic',
          required: true,
        },
      ],
    },
    model_config: {
      text_llm: MODELS.SONNET_4_5,
    },
    tags: ['twitter', 'x', 'thread', 'social-media', 'viral'],
    difficulty: 'beginner',
    estimated_time: '45 seconds',
  },
];

// =============================================================================
// VIDEO GENERATION BLUEPRINTS
// =============================================================================

export const videoGenerationBlueprints: StarterPackBlueprint[] = [
  {
    id: 'starter-product-video',
    name: 'Product Showcase Video',
    description: 'Professional product video using Veo 3.1 with configurable duration',
    category: 'video_generation',
    pipeline: 'generative_video_oneshot',
    master_prompt: `Generate a video prompt for a stunning product showcase.

PRODUCT: {{product}}

VIDEO SETTINGS:
- Total Duration: {{video_duration_minutes}} minute(s)
- Number of Scenes: {{scene_count}}
- Scene Duration: {{scene_duration}} seconds each

Create a detailed video generation prompt that captures:

## VIDEO CONCEPT

**Scene description:**
[Detailed description of the scene, lighting, and environment]

**Camera movement:**
[Slow dolly, orbit, push-in, static, etc.]

**Product interaction:**
[How the product is featured - being used, rotating, in context]

**Mood and lighting:**
[Cinematic, bright, moody, natural, studio, etc.]

---

## SCENE BREAKDOWN

Generate {{scene_count}} distinct scenes, each approximately {{scene_duration}} seconds:

{{#scene_count}}
**Scene 1:** [Opening shot - establish the product]
**Scene 2:** [Detail/feature highlight]
**Scene 3:** [Product in action/context]
[Continue for all scenes...]
{{/scene_count}}

---

## OPTIMIZED VIDEO PROMPT

[Write a single, detailed paragraph prompt optimized for Veo 3.1. Include:
- Scene setting and environment
- Lighting description
- Camera movement
- Product focus and any motion
- Overall mood/style
- Quality descriptors: "cinematic", "professional", "high-end"]

---

## ALTERNATIVE ANGLES

**Version 2 - Different angle:**
[Alternative prompt with different approach]

**Version 3 - Lifestyle context:**
[Alternative prompt showing product in use]`,
    structure: {
      slots: [
        {
          key: 'product',
          type: 'text',
          label: 'Describe your product',
          required: true,
        },
      ],
    },
    model_config: {
      text_llm: MODELS.SONNET_4_5,
      world_simulator: MODELS.VEO_3_1,
    },
    tags: ['video', 'product', 'showcase', 'veo', 'ai-video'],
    difficulty: 'intermediate',
    estimated_time: '2 minutes',
  },
  {
    id: 'starter-ai-video-ad',
    name: 'AI Video Ad',
    description: 'Generate a compelling video advertisement using Veo 3.1 world simulator',
    category: 'video_generation',
    pipeline: 'generative_video_oneshot',
    master_prompt: `Create a compelling video advertisement concept.

PRODUCT/SERVICE: {{product}}
TARGET AUDIENCE: {{audience}}

VIDEO SETTINGS:
- Total Duration: {{video_duration_minutes}} minute(s)
- Number of Scenes: {{scene_count}}
- Scene Duration: {{scene_duration}} seconds each

## AD STRATEGY

**Core Message:** [The one thing viewers should remember]
**Emotional Hook:** [What feeling should this evoke]
**Call to Action:** [What should viewers do next]

---

## SCENE-BY-SCENE BREAKDOWN

Create {{scene_count}} impactful scenes for a {{video_duration_minutes}}-minute ad:

### Scene 1: THE HOOK (0:00 - {{scene_duration}}s)
**Visual:** [Attention-grabbing opening shot]
**Video Prompt:** [Detailed Veo 3.1 prompt - include setting, lighting, camera movement, action]
**Purpose:** Stop the scroll, create curiosity

### Scene 2: THE PROBLEM ({{scene_duration}}s - [next])
**Visual:** [Show the pain point or desire]
**Video Prompt:** [Detailed prompt]
**Purpose:** Create emotional connection

### Scene 3: THE SOLUTION
**Visual:** [Introduce product/service as the answer]
**Video Prompt:** [Detailed prompt]
**Purpose:** Position as the solution

### Scene 4: THE PROOF
**Visual:** [Show transformation or results]
**Video Prompt:** [Detailed prompt]
**Purpose:** Build credibility

### Scene 5: THE CTA
**Visual:** [Clear call to action with product]
**Video Prompt:** [Detailed prompt]
**Purpose:** Drive action

[Adjust scenes based on {{scene_count}}]

---

## VIDEO PROMPTS FOR VEO 3.1

For each scene, provide a detailed prompt including:
- Environment/setting description
- Lighting (natural, studio, golden hour, dramatic)
- Camera movement (dolly, orbit, push-in, static, handheld)
- Subject/action in scene
- Mood/atmosphere
- Quality keywords: "cinematic", "4K", "professional", "commercial quality"

---

## STYLE GUIDE

**Visual Style:** [Modern, luxury, energetic, warm, etc.]
**Color Palette:** [Primary colors that represent the brand]
**Pacing:** [Fast cuts, smooth transitions, or slow cinematic]`,
    structure: {
      slots: [
        {
          key: 'product',
          type: 'text',
          label: 'Product or service to advertise',
          required: true,
        },
        {
          key: 'audience',
          type: 'text',
          label: 'Target audience (e.g., busy professionals, fitness enthusiasts)',
          required: false,
        },
      ],
    },
    model_config: {
      text_llm: MODELS.SONNET_4_5,
      world_simulator: MODELS.VEO_3_1,
    },
    tags: ['video', 'ad', 'advertisement', 'veo', 'marketing', 'world-simulator'],
    difficulty: 'intermediate',
    estimated_time: '2 minutes',
  },
  {
    id: 'starter-storyboard-video',
    name: 'Storyboard Video',
    description: 'Multi-scene video with AI-generated visuals and motion',
    category: 'video_generation',
    pipeline: 'storyboard_video_longform',
    master_prompt: `Create a complete storyboard video concept.

TOPIC: {{topic}}
STYLE: {{style}}

VIDEO SETTINGS:
- Total Duration: {{video_duration_minutes}} minute(s)
- Number of Scenes: {{scene_count}}
- Scene Duration: {{scene_duration}} seconds each

## VIDEO OVERVIEW

**Concept:** [One sentence summary of the video]
**Mood/Tone:** [Cinematic, upbeat, dramatic, peaceful, etc.]
**Target Audience:** [Who is this for]

---

## DETAILED STORYBOARD

Create {{scene_count}} scenes for a {{video_duration_minutes}}-minute video:

### Scene 1 (0:00 - {{scene_duration}}s)
**Visual:** [Detailed description of what's on screen]
**Image Prompt:** [Prompt for generating the base image]
**Motion:** [How the image should animate - zoom, pan, parallax]
**Audio/Music:** [Sound design notes]

### Scene 2 ({{scene_duration}}s - [next timestamp])
**Visual:** [Description]
**Image Prompt:** [Prompt]
**Motion:** [Animation direction]
**Audio/Music:** [Notes]

[Continue for all {{scene_count}} scenes...]

---

## VISUAL STYLE GUIDE

**Color Palette:** [Primary colors and mood]
**Lighting:** [Natural, dramatic, soft, high-contrast]
**Composition:** [Rule of thirds, centered, dynamic angles]

---

## TRANSITION NOTES

[How scenes should flow into each other - cuts, fades, morphs]

---

## FINAL OUTPUT

**Aspect Ratio:** 16:9 (landscape) / 9:16 (vertical) / 1:1 (square)
**Music Suggestions:** [Genre, tempo, mood]
**Voiceover Notes:** [If applicable]`,
    image_prompt: `Create a cinematic scene image for a {{style}} video about: {{topic}}

Style requirements:
- Cinematic composition with strong visual storytelling
- High quality, photorealistic or stylized based on the {{style}} specified
- Dramatic lighting that evokes emotion
- Clear focal point that draws the eye
- Professional color grading
- 16:9 aspect ratio for video frames
- No text overlays - pure visual imagery`,
    structure: {
      slots: [
        {
          key: 'topic',
          type: 'text',
          label: 'Video topic or concept',
          required: true,
        },
        {
          key: 'style',
          type: 'text',
          label: 'Visual style (e.g., cinematic, minimalist, vibrant)',
          required: false,
        },
      ],
    },
    model_config: {
      text_llm: MODELS.SONNET_4_5,
      image_generator: {
        ...MODELS.FLUX_1_1_PRO,
        parameters: {
          ...MODELS.FLUX_1_1_PRO.parameters,
          aspect_ratio: '16:9',
        },
      },
    },
    tags: ['video', 'storyboard', 'longform', 'multi-scene', 'ai-video'],
    difficulty: 'intermediate',
    estimated_time: '3 minutes',
  },
];

// =============================================================================
// IMAGE ONLY BLUEPRINTS
// =============================================================================

export const imageOnlyBlueprints: StarterPackBlueprint[] = [
  {
    id: 'starter-product-photo',
    name: 'Product Photography',
    description: 'Professional product shots with studio lighting and clean backgrounds',
    category: 'image_only',
    pipeline: 'image_only',
    master_prompt: `Generate a professional product photography prompt.

PRODUCT: {{product}}
STYLE: {{style}}

Create a detailed image generation prompt for stunning product photography:

## PHOTOGRAPHY CONCEPT

**Shot Type:** [Hero shot, detail shot, lifestyle, flat lay, etc.]
**Background:** [Clean white, gradient, contextual, textured surface]
**Lighting:** [Studio softbox, natural window light, dramatic rim light, etc.]
**Angle:** [Eye-level, 45-degree, top-down, low angle]

---

## DETAILED IMAGE PROMPT

[Write a single, detailed paragraph optimized for Nano Banana Pro that describes:
- The product in detail
- Exact background and surface
- Lighting setup and quality
- Camera angle and composition
- Mood and style (minimal, luxury, vibrant, etc.)
- Quality keywords: "product photography", "commercial", "high-end", "professional lighting"]

---

## VARIATIONS

**Version 2 - Lifestyle Context:**
[Alternative prompt showing product in use/context]

**Version 3 - Detail/Macro:**
[Close-up focusing on texture, materials, craftsmanship]`,
    image_prompt: `Professional product photography of {{product}}.

Style: {{style}}
- Clean, commercial-grade product shot
- Professional studio lighting with soft shadows
- Minimalist background (white, gradient, or subtle texture)
- Sharp focus on product details
- High-end commercial photography aesthetic
- 1:1 aspect ratio for versatile use`,
    structure: {
      slots: [
        {
          key: 'product',
          type: 'text',
          label: 'Describe your product',
          required: true,
        },
        {
          key: 'style',
          type: 'text',
          label: 'Photography style (e.g., minimal, luxury, lifestyle)',
          required: false,
        },
      ],
    },
    model_config: {
      text_llm: MODELS.SONNET_4_5,
      image_generator: MODELS.FLUX_1_1_PRO,
    },
    tags: ['image', 'product', 'photography', 'commercial', 'ecommerce'],
    difficulty: 'beginner',
    estimated_time: '30 seconds',
  },
  {
    id: 'starter-social-media-graphic',
    name: 'Social Media Graphic',
    description: 'Eye-catching graphics for social media posts and ads',
    category: 'image_only',
    pipeline: 'image_only',
    master_prompt: `Create a social media graphic concept.

TOPIC: {{topic}}
PLATFORM: {{platform}}

## GRAPHIC CONCEPT

**Visual Style:** [Modern, bold, minimal, playful, corporate, etc.]
**Primary Colors:** [Based on topic/brand]
**Composition:** [Centered, asymmetric, grid-based]
**Text Elements:** [If any headline or CTA should be included]

---

## IMAGE PROMPT

[Detailed prompt for generating the graphic:
- Visual elements and imagery
- Color palette and gradients
- Composition and layout
- Style and mood
- Platform-specific optimization]

---

## SIZE VARIATIONS

**Square (1:1):** Best for Instagram feed, Facebook
**Portrait (4:5):** Instagram feed, Pinterest
**Story (9:16):** Instagram/Facebook Stories
**Landscape (16:9):** Twitter, LinkedIn, YouTube thumbnail`,
    image_prompt: `Social media graphic for {{platform}} about: {{topic}}

Style requirements:
- Bold, attention-grabbing visual design
- Vibrant colors with strong contrast
- Clean, modern aesthetic
- Platform-optimized composition
- Professional quality, not stock photo
- Eye-catching for social media feeds
- 1:1 square format`,
    structure: {
      slots: [
        {
          key: 'topic',
          type: 'text',
          label: 'Topic or message for the graphic',
          required: true,
        },
        {
          key: 'platform',
          type: 'text',
          label: 'Platform (e.g., Instagram, LinkedIn, Twitter)',
          required: false,
        },
      ],
    },
    model_config: {
      text_llm: MODELS.SONNET_4_5,
      image_generator: MODELS.FLUX_1_1_PRO,
    },
    tags: ['image', 'social-media', 'graphic', 'marketing', 'design'],
    difficulty: 'beginner',
    estimated_time: '30 seconds',
  },
  {
    id: 'starter-thumbnail',
    name: 'Video Thumbnail',
    description: 'Click-worthy thumbnails for YouTube, courses, and video content',
    category: 'image_only',
    pipeline: 'image_only',
    master_prompt: `Create a high-CTR video thumbnail concept.

VIDEO TITLE: {{title}}
STYLE: {{style}}

## THUMBNAIL STRATEGY

**Emotion to Evoke:** [Curiosity, excitement, urgency, surprise]
**Key Visual Element:** [Face with expression, before/after, dramatic scene]
**Text Overlay:** [Short, bold text if any - max 3-4 words]
**Color Strategy:** [Bright, contrasting colors that pop]

---

## DETAILED THUMBNAIL PROMPT

[Create a prompt that generates:
- Main visual focal point
- Background that doesn't compete
- Space for text overlay if needed
- High contrast for small preview sizes
- Emotional hook that makes viewers click]

---

## THUMBNAIL VARIATIONS

**Version 1 - Face Forward:**
[Prompt with expressive face as focal point]

**Version 2 - Object/Scene Focus:**
[Prompt featuring key object or dramatic scene]

**Version 3 - Before/After Split:**
[Prompt showing transformation or comparison]`,
    image_prompt: `YouTube video thumbnail for: {{title}}

Style: {{style}}
- High-contrast, attention-grabbing composition
- Bold, vibrant colors that pop in small sizes
- Clear focal point with space for text overlay
- Dramatic lighting and composition
- Professional quality, click-worthy design
- 16:9 aspect ratio optimized for YouTube`,
    structure: {
      slots: [
        {
          key: 'title',
          type: 'text',
          label: 'Video title or topic',
          required: true,
        },
        {
          key: 'style',
          type: 'text',
          label: 'Thumbnail style (e.g., dramatic, bright, minimal)',
          required: false,
        },
      ],
    },
    model_config: {
      text_llm: MODELS.SONNET_4_5,
      image_generator: {
        ...MODELS.FLUX_1_1_PRO,
        parameters: {
          ...MODELS.FLUX_1_1_PRO.parameters,
          aspect_ratio: '16:9',
        },
      },
    },
    tags: ['image', 'thumbnail', 'youtube', 'video', 'ctr'],
    difficulty: 'beginner',
    estimated_time: '30 seconds',
  },
  {
    id: 'starter-ai-art',
    name: 'AI Art & Illustrations',
    description: 'Creative artwork and illustrations for any purpose',
    category: 'image_only',
    pipeline: 'image_only',
    master_prompt: `Generate creative AI artwork.

CONCEPT: {{concept}}
ART STYLE: {{art_style}}

## ARTWORK CONCEPT

**Subject Matter:** [Main focus of the artwork]
**Artistic Style:** [Digital art, oil painting, watercolor, anime, etc.]
**Mood/Atmosphere:** [Ethereal, dark, whimsical, serene, dynamic]
**Color Palette:** [Warm, cool, monochrome, vibrant, pastel]
**Composition:** [Rule of thirds, centered, dynamic diagonal]

---

## DETAILED ART PROMPT

[Comprehensive prompt including:
- Subject description with details
- Art style and technique references
- Lighting and atmosphere
- Color palette specifics
- Composition guidance
- Quality enhancers: "masterpiece", "highly detailed", "professional artwork"]

---

## STYLE VARIATIONS

**Version 1 - Realistic:**
[Photorealistic interpretation of the concept]

**Version 2 - Stylized:**
[Artistic, stylized interpretation]

**Version 3 - Abstract:**
[Abstract or conceptual interpretation]`,
    image_prompt: `Creative artwork depicting: {{concept}}

Art style: {{art_style}}
- Highly detailed and visually striking
- Professional digital art quality
- Rich colors and dynamic composition
- Atmospheric lighting and mood
- Masterpiece quality illustration
- 1:1 aspect ratio`,
    structure: {
      slots: [
        {
          key: 'concept',
          type: 'text',
          label: 'Describe your artwork concept',
          required: true,
        },
        {
          key: 'art_style',
          type: 'text',
          label: 'Art style (e.g., digital art, watercolor, anime, photorealistic)',
          required: false,
        },
      ],
    },
    model_config: {
      text_llm: MODELS.SONNET_4_5,
      image_generator: MODELS.FLUX_1_1_PRO,
    },
    tags: ['image', 'art', 'illustration', 'creative', 'digital-art'],
    difficulty: 'beginner',
    estimated_time: '30 seconds',
  },
];

// =============================================================================
// VIDEO REMIX BLUEPRINTS
// =============================================================================

export const videoRemixBlueprints: StarterPackBlueprint[] = [
  {
    id: 'starter-remix-punchy-short',
    name: 'Punchy Short',
    description: 'Distill any video into a hook-driven short — focus on the single most compelling insight',
    category: 'video_remix',
    pipeline: 'video_remix',
    master_prompt: `Take this video and distill it into a punchy, hook-driven short. Focus on the single most compelling insight.

{{#product.name}}Highlight how {{product.name}} solves the problem.{{/product.name}}
{{#product.benefits}}Key benefits to weave in: {{product.benefits}}{{/product.benefits}}
{{#brandVoice.tone}}Tone: {{brandVoice.tone}}{{/brandVoice.tone}}
{{#brandVoice.writingStyle}}Writing style: {{brandVoice.writingStyle}}{{/brandVoice.writingStyle}}
{{#icp.painPoints}}Address these pain points: {{icp.painPoints}}{{/icp.painPoints}}
{{#icp.description}}Target audience: {{icp.description}}{{/icp.description}}`,
    structure: { slots: [] },
    model_config: {
      text_llm: MODELS.SONNET_4_5,
      remix_rewrite_style: 'shorten',
      remix_visual_style: 'remix',
      remix_template_type: 'product_review',
    },
    tags: ['video', 'remix', 'short-form', 'tts', 'rewrite'],
    difficulty: 'beginner',
    estimated_time: '2 minutes',
  },
  {
    id: 'starter-remix-react',
    name: 'React & Comment',
    description: 'Transform a video into reaction-style content with analysis, opinion, and commentary',
    category: 'video_remix',
    pipeline: 'video_remix',
    master_prompt: `React to this video like a knowledgeable industry insider. Add analysis, opinion, and context on top of the original content.

{{#product.name}}Compare with {{product.name}} where relevant — highlight advantages.{{/product.name}}
{{#brandVoice.tone}}Tone: {{brandVoice.tone}}{{/brandVoice.tone}}
{{#icp.painPoints}}Focus on how the content relates to: {{icp.painPoints}}{{/icp.painPoints}}`,
    structure: { slots: [] },
    model_config: {
      text_llm: MODELS.SONNET_4_5,
      remix_rewrite_style: 'react',
      remix_visual_style: 'remix',
      remix_template_type: 'competitor_teardown',
    },
    tags: ['video', 'remix', 'react', 'commentary', 'rewrite'],
    difficulty: 'beginner',
    estimated_time: '2 minutes',
  },
  {
    id: 'starter-remix-polish',
    name: 'Polish & Enhance',
    description: 'Clean up a video\'s script — remove filler, tighten language, add professional polish',
    category: 'video_remix',
    pipeline: 'video_remix',
    master_prompt: `Clean up this video's script — remove filler words, tighten language, improve flow. Keep the original structure and message intact.

{{#brandVoice.writingStyle}}Writing style: {{brandVoice.writingStyle}}{{/brandVoice.writingStyle}}
{{#brandVoice.tone}}Tone: {{brandVoice.tone}}{{/brandVoice.tone}}`,
    structure: { slots: [] },
    model_config: {
      text_llm: MODELS.SONNET_4_5,
      remix_rewrite_style: 'polish',
      remix_visual_style: 'enhance',
      remix_template_type: 'tutorial',
    },
    tags: ['video', 'remix', 'polish', 'enhance', 'cleanup'],
    difficulty: 'beginner',
    estimated_time: '2 minutes',
  },
  {
    id: 'starter-remix-translate',
    name: 'Translate & Dub',
    description: 'Translate and culturally adapt a video\'s content for a new audience',
    category: 'video_remix',
    pipeline: 'video_remix',
    master_prompt: `Translate and culturally adapt this video's content. Preserve the original meaning, tone, and emotional intent.

{{#icp.description}}Adapt for this audience: {{icp.description}}{{/icp.description}}
{{#brandVoice.tone}}Maintain this brand tone: {{brandVoice.tone}}{{/brandVoice.tone}}`,
    structure: { slots: [] },
    model_config: {
      text_llm: MODELS.SONNET_4_5,
      remix_rewrite_style: 'translate',
      remix_visual_style: 'enhance',
      remix_template_type: 'tutorial',
    },
    tags: ['video', 'remix', 'translate', 'dub', 'localization'],
    difficulty: 'beginner',
    estimated_time: '3 minutes',
  },
];

// =============================================================================
// PRESENTER VIDEO BLUEPRINTS
// =============================================================================

export const presenterVideoBlueprints: StarterPackBlueprint[] = [
  {
    id: 'starter-presenter-product-review',
    name: 'Product Review',
    description: 'Walk through a product page with feature highlights and honest verdict',
    category: 'presenter_video',
    pipeline: 'presenter_video',
    master_prompt: `You are a hands-on product reviewer making a short-form video. Walk through this product page like you're showing a friend something cool you found.

## REVIEW STRUCTURE
1. HOOK: Start with your verdict or a surprising finding ("This might be the best X I've seen" or "There's a huge problem with this")
2. OVERVIEW: Quick context — what is this product and who is it for?
3. WALKTHROUGH: Go section by section through the page. For each feature:
   - Describe what you see
   - Explain why it matters (or doesn't)
   - Compare to alternatives when relevant
4. VERDICT: Honest rating. What's great, what's missing, who should use it

## STYLE
- Alternate between praise and criticism — never be a pure cheerleader
- Use specific details from the screenshots, not generic statements
- End with a clear recommendation: "If you need X, this is worth trying"

{{#product.name}}Product: {{product.name}}{{/product.name}}
{{#product.benefits}}Key benefits to highlight: {{product.benefits}}{{/product.benefits}}
{{#brandVoice.tone}}Tone: {{brandVoice.tone}}{{/brandVoice.tone}}
{{#brandVoice.writingStyle}}Style: {{brandVoice.writingStyle}}{{/brandVoice.writingStyle}}
{{#icp.painPoints}}Address these pain points: {{icp.painPoints}}{{/icp.painPoints}}
{{#icp.description}}Target audience: {{icp.description}}{{/icp.description}}`,
    structure: { slots: [] },
    model_config: { text_llm: MODELS.SONNET_4_5 },
    tags: ['video', 'presenter', 'product-review', 'saas'],
    difficulty: 'beginner',
    estimated_time: '3 minutes',
  },
  {
    id: 'starter-presenter-competitor-teardown',
    name: 'Competitor Teardown',
    description: 'Analyze a competitor site, pricing, and positioning',
    category: 'presenter_video',
    pipeline: 'presenter_video',
    master_prompt: `You are a competitive intelligence analyst making a short-form teardown video. Dissect this competitor's website with surgical precision.

## TEARDOWN STRUCTURE
1. HOOK: Lead with the most interesting finding ("They're charging $X for something you can get free" or "Their positioning just changed — here's why")
2. POSITIONING: What do they claim to be? Who are they targeting?
3. PAGE ANALYSIS: Walk through each section of the site:
   - Hero & messaging: Is it clear? Compelling?
   - Features: What's their core value prop?
   - Pricing: How does it compare to the market?
   - Social proof: Real or manufactured?
4. VERDICT: Strengths, weaknesses, and what you can learn from them

## STYLE
- Be analytical, not mean-spirited
- Highlight UX friction points and confusing messaging
- Compare to "what good looks like" when relevant
- End with actionable takeaways

{{#product.name}}Compare against: {{product.name}}{{/product.name}}
{{#brandVoice.tone}}Tone: {{brandVoice.tone}}{{/brandVoice.tone}}
{{#icp.painPoints}}Evaluate against these user pain points: {{icp.painPoints}}{{/icp.painPoints}}
{{#icp.description}}Audience context: {{icp.description}}{{/icp.description}}`,
    structure: { slots: [] },
    model_config: { text_llm: MODELS.SONNET_4_5 },
    tags: ['video', 'presenter', 'competitor', 'teardown', 'analysis'],
    difficulty: 'intermediate',
    estimated_time: '3 minutes',
  },
  {
    id: 'starter-presenter-feature-walkthrough',
    name: 'Feature Walkthrough',
    description: 'Demo a SaaS feature with step-by-step narration',
    category: 'presenter_video',
    pipeline: 'presenter_video',
    master_prompt: `You are a product expert making a feature demo video. Show this feature like you're onboarding a new user who's already excited to try it.

## DEMO STRUCTURE
1. HOOK: Start with the outcome ("In 30 seconds, I'll show you how to X")
2. CONTEXT: Brief setup — what problem does this feature solve?
3. WALKTHROUGH: Step-by-step through the feature:
   - Point out each UI element as you discuss it
   - Explain what each action does and why
   - Highlight power-user tips and shortcuts
4. RESULT: Show the end result and explain the impact

## STYLE
- Build excitement progressively — save the best for last
- Use before/after framing where possible
- End with a clear call-to-action to try it

{{#product.name}}Product: {{product.name}}{{/product.name}}
{{#product.benefits}}Capabilities to showcase: {{product.benefits}}{{/product.benefits}}
{{#brandVoice.tone}}Tone: {{brandVoice.tone}}{{/brandVoice.tone}}
{{#icp.description}}Audience skill level: {{icp.description}}{{/icp.description}}`,
    structure: { slots: [] },
    model_config: { text_llm: MODELS.SONNET_4_5 },
    tags: ['video', 'presenter', 'feature-demo', 'saas', 'walkthrough'],
    difficulty: 'beginner',
    estimated_time: '3 minutes',
  },
  {
    id: 'starter-presenter-news-commentary',
    name: 'News Commentary',
    description: 'React to a news article with your take and analysis',
    category: 'presenter_video',
    pipeline: 'presenter_video',
    master_prompt: `You are a sharp industry commentator making a short-form reaction video to this article/announcement. Give your audience the TLDR plus your unfiltered take.

## COMMENTARY STRUCTURE
1. HOOK: Lead with your hot take ("This changes everything for X" or "Everyone's celebrating but here's what they're missing")
2. SUMMARY: What happened? Distill the article to 2-3 key facts
3. ANALYSIS: Quote key sentences from the article, then add your perspective:
   - Why does this matter?
   - Who wins and who loses?
   - What's the second-order effect nobody's talking about?
4. TAKEAWAY: End with "why this matters for YOU" — make it actionable

## STYLE
- Be opinionated — hot takes get engagement
- Quote specific lines from the article for credibility
- Connect the news to your audience's daily reality
- Conversational energy, like you're telling a friend about something you just read

{{#product.name}}Relate back to {{product.name}} where relevant.{{/product.name}}
{{#brandVoice.tone}}Tone: {{brandVoice.tone}}{{/brandVoice.tone}}
{{#brandVoice.writingStyle}}Style: {{brandVoice.writingStyle}}{{/brandVoice.writingStyle}}
{{#icp.description}}Audience: {{icp.description}}{{/icp.description}}
{{#icp.painPoints}}Connect to these concerns: {{icp.painPoints}}{{/icp.painPoints}}`,
    structure: { slots: [] },
    model_config: { text_llm: MODELS.SONNET_4_5 },
    tags: ['video', 'presenter', 'news', 'commentary', 'reaction'],
    difficulty: 'beginner',
    estimated_time: '3 minutes',
  },
  {
    id: 'starter-presenter-tutorial',
    name: 'Tutorial',
    description: 'Step-by-step how-to guide with annotated screenshots',
    category: 'presenter_video',
    pipeline: 'presenter_video',
    master_prompt: `You are a patient, clear instructor making a step-by-step tutorial video. Walk through this page like you're teaching someone who's never used this tool before.

## TUTORIAL STRUCTURE
1. HOOK: State the outcome clearly ("By the end of this, you'll know how to X")
2. PREREQUISITES: What does the viewer need before starting? (30 seconds max)
3. STEPS: Walk through each action:
   - Number each step clearly ("Step 1: Click on...")
   - Show exactly where to click and what to fill in
   - Pause on important details — don't rush past configuration
   - Warn about common mistakes
4. VERIFICATION: Show how to confirm it worked

## STYLE
- Number every step with text overlays
- Slower pacing than other templates — let people follow along
- Use "notice how" and "make sure you" language
- End with "Next steps" or where to go for help

{{#product.name}}Product: {{product.name}}{{/product.name}}
{{#product.benefits}}Highlight these capabilities: {{product.benefits}}{{/product.benefits}}
{{#brandVoice.tone}}Tone: {{brandVoice.tone}}{{/brandVoice.tone}}
{{#icp.description}}Skill level of audience: {{icp.description}}{{/icp.description}}`,
    structure: { slots: [] },
    model_config: { text_llm: MODELS.SONNET_4_5 },
    tags: ['video', 'presenter', 'tutorial', 'how-to', 'walkthrough'],
    difficulty: 'beginner',
    estimated_time: '4 minutes',
  },
  {
    id: 'starter-presenter-listicle',
    name: 'Listicle',
    description: 'Top-N list from a source page with countdown energy',
    category: 'presenter_video',
    pipeline: 'presenter_video',
    master_prompt: `You are an energetic content creator making a countdown/listicle video. Extract the best items from this page and rank them for maximum engagement.

## LISTICLE STRUCTURE
1. HOOK: Tease the list and the #1 pick ("I found the top 5 X on this page — #1 blew my mind")
2. ITEMS: Present each item with:
   - Clear numbering with text overlays
   - What it is and why it made the list
   - Quick verdict or rating for each
   - Build anticipation toward #1
3. REVEAL: Make #1 a moment — explain why it wins
4. CTA: "Which one are you trying first? Drop a comment"

## STYLE
- Quick cuts between items — keep momentum
- Number each item with big text overlays
- Build anticipation toward the #1 pick
- End with engagement hook (question, poll, "save this for later")

{{#brandVoice.tone}}Tone: {{brandVoice.tone}}{{/brandVoice.tone}}
{{#icp.description}}Audience: {{icp.description}}{{/icp.description}}
{{#icp.painPoints}}Focus on items that solve: {{icp.painPoints}}{{/icp.painPoints}}`,
    structure: { slots: [] },
    model_config: { text_llm: MODELS.SONNET_4_5 },
    tags: ['video', 'presenter', 'listicle', 'top-n', 'countdown'],
    difficulty: 'beginner',
    estimated_time: '3 minutes',
  },
  {
    id: 'starter-presenter-landing-page-audit',
    name: 'Landing Page Audit',
    description: 'Grade a landing page section-by-section with UX analysis',
    category: 'presenter_video',
    pipeline: 'presenter_video',
    master_prompt: `You are a conversion rate optimization expert auditing this landing page on camera. Grade each section and explain what works and what doesn't.

## AUDIT STRUCTURE
1. HOOK: Lead with the overall grade or a surprising finding ("This landing page is leaving money on the table — here's how")
2. ABOVE THE FOLD: Grade the hero section:
   - Is the headline clear and benefit-driven?
   - Does the subheadline support it?
   - Is the CTA visible and compelling?
3. SECTION-BY-SECTION: Walk down the page grading:
   - Value proposition clarity
   - Social proof (testimonials, logos, numbers)
   - Feature presentation
   - Pricing (if visible)
   - Final CTA
4. SCORECARD: Give an overall grade and the #1 thing they should fix

## STYLE
- Use text overlays for grades (A, B, C, D, F) on each section
- Be constructive — "This is good, but it could be great if..."
- Highlight UX friction points with specific callouts
- Reference CRO best practices

{{#product.name}}Auditing: {{product.name}}{{/product.name}}
{{#brandVoice.tone}}Tone: {{brandVoice.tone}}{{/brandVoice.tone}}
{{#icp.painPoints}}Evaluate against user pain points: {{icp.painPoints}}{{/icp.painPoints}}
{{#icp.description}}Target audience context: {{icp.description}}{{/icp.description}}`,
    structure: { slots: [] },
    model_config: { text_llm: MODELS.SONNET_4_5 },
    tags: ['video', 'presenter', 'landing-page', 'audit', 'ux', 'cro'],
    difficulty: 'beginner',
    estimated_time: '3 minutes',
  },
  {
    id: 'starter-presenter-industry-analysis',
    name: 'Industry Analysis',
    description: 'Deep dive into a market trend or industry report',
    category: 'presenter_video',
    pipeline: 'presenter_video',
    master_prompt: `You are a market analyst breaking down this industry report or trend piece. Make complex data accessible and actionable for your audience.

## ANALYSIS STRUCTURE
1. HOOK: Open with the key trend or stat ("The X market just hit $Y billion — here's what that means for you")
2. CONTEXT: Why does this matter now? What changed?
3. DATA WALKTHROUGH: Go through the key data points:
   - Highlight the most important numbers with stat callouts
   - Connect dots between data points to tell a story
   - Explain what the numbers mean in plain language
4. IMPLICATIONS: Who wins? Who loses? What should people do?
5. PREDICTION: End with your take on what happens next

## STYLE
- Use stat overlays for key numbers
- Connect abstract data to concrete outcomes
- End with a prediction or actionable insight
- Be the smart friend who reads reports so they don't have to

{{#brandVoice.tone}}Tone: {{brandVoice.tone}}{{/brandVoice.tone}}
{{#brandVoice.writingStyle}}Style: {{brandVoice.writingStyle}}{{/brandVoice.writingStyle}}
{{#icp.description}}Audience: {{icp.description}}{{/icp.description}}`,
    structure: { slots: [] },
    model_config: { text_llm: MODELS.SONNET_4_5 },
    tags: ['video', 'presenter', 'industry', 'analysis', 'trends', 'data'],
    difficulty: 'intermediate',
    estimated_time: '3 minutes',
  },
  {
    id: 'starter-presenter-tool-comparison',
    name: 'Tool Comparison',
    description: 'Side-by-side breakdown of competing tools or services',
    category: 'presenter_video',
    pipeline: 'presenter_video',
    master_prompt: `You are a tech reviewer doing a head-to-head comparison video. Break down this tool against its competition fairly and help viewers decide.

## COMPARISON STRUCTURE
1. HOOK: State the matchup and tease the winner ("X vs Y — I tested both and the winner surprised me")
2. OVERVIEW: Quick intro to both tools — what they claim to do
3. CATEGORIES: Compare across 4-5 dimensions:
   - Features / capabilities
   - UI / ease of use
   - Pricing / value
   - Performance / reliability
   - Support / ecosystem
   Use text overlays for scoring each category
4. VERDICT: Clear winner per category and overall. "It depends" is fine if you explain the criteria

## STYLE
- Structure as head-to-head — show one tool then the other
- Use text overlays for scoring categories
- Be fair — every tool has strengths
- End with a clear recommendation based on use case

{{#product.name}}Comparing: {{product.name}}{{/product.name}}
{{#brandVoice.tone}}Tone: {{brandVoice.tone}}{{/brandVoice.tone}}
{{#icp.description}}Audience: {{icp.description}}{{/icp.description}}
{{#icp.painPoints}}Evaluate based on: {{icp.painPoints}}{{/icp.painPoints}}`,
    structure: { slots: [] },
    model_config: { text_llm: MODELS.SONNET_4_5 },
    tags: ['video', 'presenter', 'comparison', 'versus', 'tools'],
    difficulty: 'intermediate',
    estimated_time: '3 minutes',
  },
  {
    id: 'starter-presenter-behind-the-scenes',
    name: 'Behind the Scenes',
    description: 'Show how something works under the hood',
    category: 'presenter_video',
    pipeline: 'presenter_video',
    master_prompt: `You are a curious tech explorer showing your audience what's happening behind the scenes. Reveal the hidden details and non-obvious features of this page.

## BTS STRUCTURE
1. HOOK: "Most people use X without knowing this..." or "Let me show you what's really going on here"
2. SURFACE: What does this look like to a normal user?
3. DEEP DIVE: Reveal the hidden layers:
   - Technical architecture or design decisions
   - Features most people miss
   - Easter eggs or hidden settings
   - How it actually works vs how it appears to work
4. INSIGHT: Why does this matter? What can you learn from it?

## STYLE
- Adopt a curious, exploratory tone — like you're discovering things in real-time
- Zoom in on interesting details
- Use "did you notice..." and "most people miss this..." framing
- Make the mundane feel fascinating

{{#product.name}}Exploring: {{product.name}}{{/product.name}}
{{#brandVoice.tone}}Tone: {{brandVoice.tone}}{{/brandVoice.tone}}
{{#icp.description}}Audience: {{icp.description}}{{/icp.description}}`,
    structure: { slots: [] },
    model_config: { text_llm: MODELS.SONNET_4_5 },
    tags: ['video', 'presenter', 'behind-the-scenes', 'deep-dive', 'exploration'],
    difficulty: 'intermediate',
    estimated_time: '3 minutes',
  },
  {
    id: 'starter-presenter-reaction',
    name: 'Reaction',
    description: 'React and comment on any web content or announcement',
    category: 'presenter_video',
    pipeline: 'presenter_video',
    master_prompt: `You are a charismatic content creator reacting to this page in real-time. Give your genuine first impressions with energy and personality.

## REACTION STRUCTURE
1. HOOK: Immediate reaction — "Wait, WHAT?" or "Okay, I need to talk about this"
2. FIRST IMPRESSIONS: Go through the page reacting naturally:
   - Call out what catches your eye first
   - Express genuine surprise, excitement, or skepticism
   - Pause on moments that deserve deeper analysis
3. BREAKDOWN: After initial reactions, give your actual analysis:
   - What's genuinely good?
   - What's overhyped or misleading?
   - How does this compare to your expectations?
4. VERDICT: Quick take — "Worth it" / "Skip it" / "Keep an eye on this"

## STYLE
- Lead with genuine first impressions — don't over-script
- Mix praise and skepticism for authenticity
- Keep energy high — reactions should feel spontaneous
- Use dramatic pauses before revealing your thoughts on key moments

{{#brandVoice.tone}}Tone: {{brandVoice.tone}}{{/brandVoice.tone}}
{{#brandVoice.writingStyle}}Style: {{brandVoice.writingStyle}}{{/brandVoice.writingStyle}}
{{#icp.description}}Audience: {{icp.description}}{{/icp.description}}`,
    structure: { slots: [] },
    model_config: { text_llm: MODELS.SONNET_4_5 },
    tags: ['video', 'presenter', 'reaction', 'first-impressions', 'commentary'],
    difficulty: 'beginner',
    estimated_time: '3 minutes',
  },
  {
    id: 'starter-presenter-explainer',
    name: 'Explainer',
    description: 'Break down a complex topic for beginners',
    category: 'presenter_video',
    pipeline: 'presenter_video',
    master_prompt: `You are a gifted educator who makes complex topics simple. Break down this page's content so anyone can understand it, regardless of background.

## EXPLAINER STRUCTURE
1. HOOK: Start with "what is this and why should you care" — make it relevant
2. SIMPLE DEFINITION: Explain the concept in one sentence a 12-year-old would understand
3. BREAKDOWN: Walk through the key concepts:
   - Break complex ideas into 3-4 simple points
   - Use analogies and real-world comparisons
   - Show the screenshots as visual aids to support each point
4. PRACTICAL TAKEAWAY: "Here's what you can actually do with this knowledge"

## STYLE
- Never assume prior knowledge
- Use text cards for key definitions
- Build understanding progressively — each point builds on the last
- End with a practical, actionable takeaway
- Use "Think of it like..." and "In simple terms..." framing

{{#brandVoice.tone}}Tone: {{brandVoice.tone}}{{/brandVoice.tone}}
{{#icp.description}}Audience skill level: {{icp.description}}{{/icp.description}}
{{#icp.painPoints}}Address confusion around: {{icp.painPoints}}{{/icp.painPoints}}`,
    structure: { slots: [] },
    model_config: { text_llm: MODELS.SONNET_4_5 },
    tags: ['video', 'presenter', 'explainer', 'education', 'beginner-friendly'],
    difficulty: 'beginner',
    estimated_time: '3 minutes',
  },
];

// =============================================================================
// UNIFIED VIDEO BLUEPRINTS
// =============================================================================

const VIDEO_DIRECTOR_PROMPT_TUTORIAL = `You are directing a clear, instructional tutorial video.
- Use slow, deliberate pacing — give viewers time to follow along.
- When showing screenshots or frames, use red_circle or underline_draw highlights to point out UI elements the narration references.
- Use ken_burns_slow or hold camera moves. Avoid fast cuts.
- Insert text_card shots between sections to show step numbers or section titles.
- Transitions: fade or slide_left between sections, cut_hard within sections.`;

const VIDEO_DIRECTOR_PROMPT_VIRAL = `You are editing a viral short-form video.
- Fast, punchy cuts — no shot longer than 4 seconds.
- Open with the most dramatic/surprising moment (hook in first 2 seconds).
- Use slam_zoom and snap_cut transitions for energy.
- Add sound_effect on every transition for dopamine hits.
- caption_style: tiktok_bounce. Emphasize 2-3 power words per shot.
- End with a clear CTA text_card.`;

const VIDEO_DIRECTOR_PROMPT_YOUTUBE = `You are a YouTube video editor optimizing for retention.
- Hook: First shot must grab attention — use hook_dramatic text_style or a surprising visual.
- Pacing: Mix 3-5s informational shots with 1-2s quick cuts for energy.
- Use stat_card and quote_card layouts to break up visual monotony.
- Transitions: Vary between fade, slide_left, and cut_hard — don't repeat the same transition more than twice in a row.
- Add sound_effect on key moments: ding for insights, pop for reveals, whoosh for transitions.
- End with gradient_title CTA shot.`;

export const unifiedVideoBlueprints: StarterPackBlueprint[] = [
  {
    id: 'starter-video-blog-to-video',
    name: 'Blog/Page to Video',
    description: 'Turn any web page into a narrated video with screenshots and AI voiceover',
    category: 'video',
    pipeline: 'video',
    master_prompt: `You are a content narrator. Read the web page content and create a compelling narration that walks the viewer through the key points.

Structure:
1. Hook — attention-grabbing opening line about why this matters
2. Walkthrough — narrate the main content, highlighting key features/points
3. Summary — wrap up with the most important takeaway
4. CTA — tell the viewer what to do next

Keep it conversational, like a friend showing you something interesting they found online.
Target duration: {{targetDuration}} seconds.

{{#ai_talking_points_list}}
Key talking points to cover:
{{ai_talking_points_list}}
{{/ai_talking_points_list}}`,
    structure: { slots: [] },
    model_config: {
      text_llm: MODELS.SONNET_4_5,
      prompt_overrides: {},
      presenter_default_source_type: 'url',
      video_config_defaults: {
        source: 'url',
        orientation: 'portrait',
        voiceMode: 'voiceover',
        imageMode: 'none',
      },
    },
    tags: ['video', 'web-to-video', 'narration'],
    difficulty: 'beginner',
    estimated_time: '3-5 minutes',
  },
  {
    id: 'starter-video-ai-storyboard',
    name: 'AI Storyboard Video',
    description: 'Generate a video from scratch with AI narration and AI-generated scene images',
    category: 'video',
    pipeline: 'video',
    master_prompt: `You are a visual storyteller. Create a compelling narrative about {{topic}} with vivid scene descriptions.

Structure your narration in 5-8 sections:
1. **Hook** — A surprising fact, bold claim, or intriguing question
2-6. **Body sections** — Each section covers one key point with a clear visual scene
7. **Climax** — The most impactful insight or revelation
8. **CTA** — Clear call-to-action

Each section should paint a picture — describe what the viewer should see. The AI will generate images to match.
Target duration: {{targetDuration}} seconds.`,
    image_prompt: `Create a cinematic, photorealistic scene image. Style: modern, clean, professional with dramatic lighting.
{{#brandVoice.visualIdentity.mood}}Mood: {{brandVoice.visualIdentity.mood}}{{/brandVoice.visualIdentity.mood}}
The image should visually represent the scene described in the narration. No text in the image.`,
    structure: { slots: [] },
    model_config: {
      text_llm: MODELS.SONNET_4_5,
      image_generator: MODELS.FLUX_1_1_PRO,
      prompt_overrides: {},
      presenter_default_source_type: 'prompt_only',
      video_config_defaults: {
        source: 'prompt_only',
        orientation: 'portrait',
        voiceMode: 'voiceover',
        imageMode: 'ai_generated',
      },
    },
    tags: ['video', 'storyboard', 'ai-images', 'narration'],
    difficulty: 'beginner',
    estimated_time: '5-8 minutes',
  },
  {
    id: 'starter-video-remix-translate',
    name: 'Video Translator',
    description: 'Import a video and translate it to another language with AI dubbing',
    category: 'video',
    pipeline: 'video',
    master_prompt: `Translate the video script to {{targetLanguage}} while preserving:
- The original tone and energy level
- Cultural references (adapt them to the target culture when needed)
- The timing and pacing — keep section durations similar to the original
- Key technical terms (keep them in English if they're widely understood)

Make the translation sound natural, not robotic. It should feel like the video was originally made in {{targetLanguage}}.`,
    structure: { slots: [] },
    model_config: {
      text_llm: MODELS.SONNET_4_5,
      prompt_overrides: {},
      remix_rewrite_style: 'translate',
      presenter_default_source_type: 'upload_video',
      video_config_defaults: {
        source: 'upload_video',
        voiceMode: 'voiceover',
        imageMode: 'none',
      },
    },
    tags: ['video', 'translation', 'dubbing', 'remix'],
    difficulty: 'beginner',
    estimated_time: '5-10 minutes',
  },
  {
    id: 'starter-video-viral-short',
    name: 'Viral Short from Long Video',
    description: 'Extract the most engaging 30-60 seconds from a long video for TikTok/Reels/Shorts',
    category: 'video',
    pipeline: 'video',
    master_prompt: `You are a viral content editor. Analyze the video transcript and identify the SINGLE most emotionally engaging, surprising, or valuable moment.

Rewrite the script for a 30-60 second viral clip:
1. **Hook (0-3s)** — The most shocking/interesting statement. Pattern interrupt. Bold claim.
2. **Build (3-20s)** — Quick context to understand why this matters
3. **Payoff (20-45s)** — The full insight, story, or demonstration
4. **CTA (45-60s)** — "Follow for more", "Link in bio", or engagement prompt

Rules:
- Cut ruthlessly. Every word must earn its place.
- Start mid-action or mid-sentence for maximum hook power.
- Use short, punchy sentences. 3-5 words when possible.`,
    structure: { slots: [] },
    model_config: {
      text_llm: MODELS.SONNET_4_5,
      prompt_overrides: {},
      remix_rewrite_style: 'shorten',
      presenter_default_source_type: 'upload_video',
      video_config_defaults: {
        source: 'upload_video',
        orientation: 'portrait',
        voiceMode: 'voiceover',
        imageMode: 'none',
      },
    },
    director_prompt: VIDEO_DIRECTOR_PROMPT_VIRAL,
    tags: ['video', 'viral', 'short-form', 'tiktok', 'reels'],
    difficulty: 'intermediate',
    estimated_time: '3-5 minutes',
  },
  {
    id: 'starter-video-tutorial-walkthrough',
    name: 'Tutorial Walkthrough',
    description: 'Create step-by-step tutorial videos from web pages or screen recordings',
    category: 'video',
    pipeline: 'video',
    master_prompt: `You are an instructional designer creating a clear, beginner-friendly tutorial.

Structure the narration as a step-by-step walkthrough:
1. **Introduction** — What we're going to learn and why it matters (10-15s)
2. **Prerequisites** — What you need before starting (5-10s)
3-N. **Steps** — Each step should:
   - Start with "Step N:" clearly
   - Explain WHAT to do and WHERE to click/look
   - Mention the expected result
   - Keep each step to 10-20 seconds
N+1. **Summary** — Quick recap of all steps (10-15s)
N+2. **Next Steps** — What to learn next or where to get help (5-10s)

Keep language simple and direct. Say "Click the blue Save button in the top right" not "Navigate to the save functionality."
Target duration: {{targetDuration}} seconds.`,
    structure: { slots: [] },
    model_config: {
      text_llm: MODELS.SONNET_4_5,
      prompt_overrides: {},
      presenter_default_source_type: 'url',
      video_config_defaults: {
        source: 'url',
        orientation: 'landscape',
        voiceMode: 'voiceover',
        imageMode: 'none',
        subtitleStyle: 'minimal',
      },
    },
    director_prompt: VIDEO_DIRECTOR_PROMPT_TUTORIAL,
    tags: ['video', 'tutorial', 'walkthrough', 'educational'],
    difficulty: 'beginner',
    estimated_time: '5-10 minutes',
  },
  {
    id: 'starter-video-youtube-hook-optimizer',
    name: 'YouTube Hook Optimizer',
    description: 'Re-do the first 15 seconds of your video to maximize YouTube retention',
    category: 'video',
    pipeline: 'video',
    master_prompt: `You are a YouTube retention expert. Analyze the first 15 seconds of this video and rewrite the hook to MAXIMIZE viewer retention.

Rewrite techniques (use 1-2):
- **Pattern Interrupt** — Start with something unexpected that breaks the scroll
- **Curiosity Gap** — Promise valuable information without revealing it
- **Bold Claim** — Make a specific, surprising statement ("I increased revenue 400% with one change")
- **Question** — Ask a question the viewer desperately wants answered
- **Story Open** — Begin mid-action in a compelling story

Rules:
- Keep the core message/topic the same
- Make viewers physically unable to scroll away
- First 3 words are the most important — make them count
- Don't use clichd openings like "Hey guys" or "In this video"`,
    structure: { slots: [] },
    model_config: {
      text_llm: MODELS.SONNET_4_5,
      prompt_overrides: {},
      remix_rewrite_style: 'custom',
      remix_custom_rewrite_instructions: 'Only rewrite the first 15 seconds. Keep the rest identical.',
      presenter_default_source_type: 'upload_video',
      video_config_defaults: {
        source: 'upload_video',
        voiceMode: 'voiceover',
        imageMode: 'none',
      },
    },
    director_prompt: VIDEO_DIRECTOR_PROMPT_YOUTUBE,
    tags: ['video', 'youtube', 'hook', 'retention'],
    difficulty: 'intermediate',
    estimated_time: '3-5 minutes',
  },
  {
    id: 'starter-video-product-explainer',
    name: 'Product Explainer',
    description: 'Create a professional product explainer with AI avatar presenter and generated visuals',
    category: 'video',
    pipeline: 'video',
    master_prompt: `You are creating a {{targetDuration}}-second product explainer video for {{product.name}}.

Structure:
1. **Problem (15%)** — Paint the pain point. Make the viewer feel the frustration.
2. **Solution (10%)** — Introduce {{product.name}} as the answer
3. **Key Features (50%)** — Walk through 3-4 top features with clear benefits
   - For each feature: "With [feature], you can [benefit]"
4. **Social Proof (10%)** — Mention results, testimonials, or adoption numbers
5. **CTA (15%)** — Clear next step. Make it easy and urgent.

Tone: Professional but warm. Confident but not pushy.
{{#product.description}}Product: {{product.description}}{{/product.description}}
{{#product.features}}Features: {{product.features}}{{/product.features}}`,
    image_prompt: `Create a clean, modern product visualization. Show the product in context — how it looks when someone is using it. Professional lighting, minimal background. Brand colors if available.`,
    structure: {
      slots: [
        { key: 'product', type: 'library_element', label: 'Product', library_table: 'library_products', required: true },
      ],
    },
    model_config: {
      text_llm: MODELS.SONNET_4_5,
      image_generator: MODELS.FLUX_1_1_PRO,
      prompt_overrides: {},
      presenter_default_source_type: 'prompt_only',
      video_config_defaults: {
        source: 'prompt_only',
        orientation: 'portrait',
        voiceMode: 'avatar',
        imageMode: 'ai_generated',
      },
    },
    tags: ['video', 'product', 'explainer', 'avatar', 'ai-images'],
    difficulty: 'intermediate',
    estimated_time: '5-10 minutes',
  },
];

// =============================================================================
// COMBINED EXPORTS
// =============================================================================

// =============================================================================
// TWITTER/X THREAD BLUEPRINTS
// =============================================================================

export const twitterBlueprints: StarterPackBlueprint[] = [
  {
    id: 'starter-twitter-thread',
    name: 'X / Twitter Thread',
    description: 'Generate a high-engagement multi-tweet thread that educates, entertains, or tells a story',
    category: 'twitter',
    pipeline: 'twitter_thread',
    master_prompt: `Generate a high-engagement X (Twitter) thread on the topic below.

TOPIC: {{topic}}

{{ai_talking_points_list}}

OUTPUT FORMAT:
Return ONLY a valid JSON object with this exact structure:
{
  "tweets": [
    { "text": "Tweet 1 text here" },
    { "text": "Tweet 2 text here" },
    ...
  ]
}

THREAD RULES:
- 5 to 10 tweets total
- Each tweet must be under 280 characters (count carefully)
- Tweet 1 (hook): Bold statement, surprising fact, or compelling question — no "Thread:" prefix
- Tweets 2-N (body): One clear idea per tweet. Use numbered format like "2/" if desired
- Last tweet: strong takeaway + "Follow for more [topic] insights" or similar CTA
- Write conversationally — short sentences, plain language, no corporate speak
- No hashtags inside tweet text (they waste characters)
- Do NOT include markdown, code fences, or commentary outside the JSON

{{ai_talking_points_list}}`,
    structure: {
      slots: [
        {
          key: 'topic',
          type: 'text',
          label: 'What is your thread about?',
          required: true,
        },
        {
          key: 'ai_talking_points_list',
          type: 'text',
          label: 'Key points to cover (optional — one per line)',
          required: false,
        },
      ],
    },
    model_config: {
      text_llm: MODELS.SONNET_4_5,
    },
    tags: ['twitter', 'x', 'thread', 'social-media', 'engagement'],
    difficulty: 'beginner',
    estimated_time: '30 seconds',
  },
];

export const allStarterPackBlueprints: StarterPackBlueprint[] = [
  ...linkedinBlueprints,
  ...instagramBlueprints,
  ...blogBlueprints,
  ...imageOnlyBlueprints,
  ...unifiedVideoBlueprints,
  ...twitterBlueprints,
];

// Grouped by category for UI
export const starterPackByCategory = {
  linkedin: {
    name: 'LinkedIn',
    description: 'Build authority and engagement on LinkedIn',
    icon: 'linkedin',
    blueprints: linkedinBlueprints,
  },
  instagram: {
    name: 'Instagram',
    description: 'Create scroll-stopping visual content',
    icon: 'instagram',
    blueprints: instagramBlueprints,
  },
  blog: {
    name: 'Blog & Email',
    description: 'Long-form content and newsletters',
    icon: 'file-text',
    blueprints: blogBlueprints,
  },
  image_only: {
    name: 'AI Images',
    description: 'Generate stunning images with Nano Banana Pro',
    icon: 'image',
    blueprints: imageOnlyBlueprints,
  },
  video: {
    name: 'Video',
    description: 'AI-powered videos from any source — URLs, uploads, images, or text',
    icon: 'clapperboard',
    blueprints: unifiedVideoBlueprints,
  },
  twitter: {
    name: 'X / Twitter',
    description: 'Multi-tweet threads that educate, entertain, and grow your audience',
    icon: 'twitter',
    blueprints: twitterBlueprints,
  },
};

// Quick access helpers
export const getStarterBlueprintById = (id: string): StarterPackBlueprint | undefined => {
  return allStarterPackBlueprints.find(bp => bp.id === id);
};

export const getStarterBlueprintsByPipeline = (pipeline: PipelineId): StarterPackBlueprint[] => {
  return allStarterPackBlueprints.filter(bp => bp.pipeline === pipeline);
};

export const getStarterBlueprintsByTag = (tag: string): StarterPackBlueprint[] => {
  return allStarterPackBlueprints.filter(bp => bp.tags.includes(tag));
};
