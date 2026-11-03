# Available Remotion Skill Compositions

---

## openclaw_logo_reveal

**Use for:** Animated brand intro for OpenClaw pour LinkedIn. Mascot bounces in, wordmark scales up, LinkedIn badge slides in, tagline fades up, shine sweep finishes.
**Aspect ratio:** square (1:1)
**Duration:** 6s

**Props schema:**
```json
{
  "imageUrl": "string — public URL of the OpenClaw logo image",
  "tagline": "string (optional) — tagline text, default: \"L'IA qui développe votre entreprise.\""
}
```

**Example:**
```json
{
  "imageUrl": "https://your-bucket.supabase.co/storage/v1/object/public/content-media/openclaw-logo.jpg",
  "tagline": "L'IA qui développe votre entreprise."
}
```

**When to use:** User uploads the OpenClaw logo image and wants it animated as a video intro
**When NOT to use:** Any other brand or content type

---

These are pre-built, production-quality Remotion components you can assign to a scene using `use_skill_composition`. They handle all internal animations, transitions, and layout — you only fill in the data props.

---

## ai_news_video

**Use for:** News roundup, weekly digest, top-N lists, trending topics, industry updates
**Aspect ratio:** portrait or landscape (both supported)
**Duration:** ~38s for 5 items (adjust proportionally — ~6s per item + 6s for intro/outro)

**Props schema:**
```json
{
  "title": "string — e.g. 'AI NEWS', 'CRYPTO WEEKLY', 'TOP 5 TOOLS'",
  "date": "string — e.g. 'March 22, 2026'",
  "newsItems": [
    {
      "headline": "string — short punchy headline, under 60 chars",
      "summary": "string — 1-2 sentence summary, under 200 chars",
      "source": "string — source name e.g. 'OpenAI', 'Reuters', 'TechCrunch'",
      "icon": "string — single emoji that fits the topic",
      "accentColor": "string — hex color, pick distinct colors per item e.g. '#10b981'"
    }
  ]
}
```

**Example:**
```json
{
  "title": "AI NEWS",
  "date": "March 22, 2026",
  "newsItems": [
    {
      "headline": "GPT-5 Launches with 1M Context",
      "summary": "OpenAI releases its most capable model with extended reasoning and agentic workflows.",
      "source": "OpenAI",
      "icon": "🧠",
      "accentColor": "#10b981"
    },
    {
      "headline": "Gemini 3.1 Tops 13 Benchmarks",
      "summary": "Google's latest model leads across coding, reasoning, and multimodal tasks.",
      "source": "Google DeepMind",
      "icon": "💎",
      "accentColor": "#6366f1"
    }
  ]
}
```

**When to use:** User asks for "AI news this week", "top 5 tools", "weekly roundup", "trending in X" — works in both portrait and landscape
**When NOT to use:** Single-topic deep dives, tutorial-style content
