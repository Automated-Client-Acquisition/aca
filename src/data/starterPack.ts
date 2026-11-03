import { ACA_ASSETS_URL } from "@/config/site";
// Starter Pack Templates - Pre-built library assets for new users
// These are designed for direct response marketing and content creation

export interface StarterBrandVoice {
  id: string;
  name: string;
  description: string;
  tone: string;
  style_guidelines: string;
  visual_template: 'minimal' | 'bold' | 'elegant' | 'playful' | 'professional';
  mood_keywords: string[];
}

export interface StarterCharacter {
  id: string;
  name: string;
  description: string;
  gender: string;
  age_range: string;
  ethnicity: string;
  build: string;
  hair_description: string;
  typical_clothing: string;
  overall_tone: string;
  speaking_style: string;
  personality_traits: string[];
  tags: string[];
  reference_images: string[];
}

export interface StarterICP {
  id: string;
  name: string;
  description: string;
  pain_points: string[];
  desires: string[];
  objections: string[];
  language_style: string;
  tags: string[];
}

export interface StarterProduct {
  id: string;
  name: string;
  description: string;
  category: string;
  features: string[];
  key_benefits: string[];
  tags: string[];
}

export interface StarterBlock {
  id: string;
  name: string;
  block_type: 'hook' | 'angle' | 'cta' | 'story_element' | 'visual_style';
  content: string;
  tags: string[];
}

export interface StarterIdea {
  id: string;
  title: string;
  category: string;
  tags: string[];
}

// =============================================================================
// BRAND VOICES
// =============================================================================

export const starterBrandVoices: StarterBrandVoice[] = [
  {
    id: "voice-authority-expert",
    name: "Authority Expert",
    description: "Commanding thought leadership voice that positions you as the go-to expert in your space",
    tone: "Confident, authoritative, educational. Speaks from experience with conviction. Uses data and case studies to back claims.",
    style_guidelines: `- Lead with bold claims backed by evidence
- Use "Here's what most people get wrong..." framing
- Share insider knowledge and contrarian takes
- Reference specific results and numbers
- Avoid hedging language (maybe, perhaps, might)
- Write in short, punchy sentences
- Use rhetorical questions to engage`,
    visual_template: "professional",
    mood_keywords: ["authoritative", "confident", "expert", "trusted", "proven"]
  },
  {
    id: "voice-friendly-guide",
    name: "Friendly Guide",
    description: "Warm, approachable educator who makes complex topics simple and actionable",
    tone: "Warm, supportive, encouraging. Like a smart friend explaining something over coffee. Patient and thorough.",
    style_guidelines: `- Use "you" frequently - make it personal
- Break complex ideas into simple steps
- Acknowledge struggles and frustrations
- Celebrate small wins
- Use analogies and everyday examples
- Write like you talk
- Include encouragement: "You've got this"`,
    visual_template: "playful",
    mood_keywords: ["friendly", "approachable", "helpful", "warm", "supportive"]
  },
  {
    id: "voice-provocateur",
    name: "The Provocateur",
    description: "Pattern-interrupt specialist who challenges conventional wisdom and sparks debate",
    tone: "Contrarian, bold, slightly confrontational. Challenges the status quo. Makes people stop scrolling.",
    style_guidelines: `- Open with controversial statements
- Call out industry BS directly
- Use "Unpopular opinion:" framing
- Challenge sacred cows
- Back up hot takes with logic
- Create "us vs them" dynamics
- End with thought-provoking questions`,
    visual_template: "bold",
    mood_keywords: ["bold", "contrarian", "provocative", "disruptive", "honest"]
  },
  {
    id: "voice-data-driven",
    name: "Data-Driven Analyst",
    description: "Evidence-based voice that wins trust through statistics, research, and logical arguments",
    tone: "Analytical, precise, credible. Lets the numbers do the talking. Objective and research-backed.",
    style_guidelines: `- Lead with specific statistics
- Cite sources and studies
- Use "Research shows..." framing
- Present before/after comparisons
- Include charts and data visualizations
- Avoid emotional language
- Build logical argument chains`,
    visual_template: "minimal",
    mood_keywords: ["analytical", "precise", "credible", "research-backed", "logical"]
  },
  {
    id: "voice-story-seller",
    name: "Story Seller",
    description: "Narrative-driven voice that sells through compelling stories and emotional connection",
    tone: "Engaging, emotional, cinematic. Draws readers in with vivid storytelling. Creates movies in minds.",
    style_guidelines: `- Open with "Picture this..." or story hooks
- Use specific sensory details
- Create tension and resolution
- Make the reader the hero
- Include dialogue and scenes
- Build to emotional climaxes
- Connect stories to lessons`,
    visual_template: "elegant",
    mood_keywords: ["storytelling", "emotional", "vivid", "engaging", "cinematic"]
  },
  {
    id: "voice-hype-machine",
    name: "Hype Machine",
    description: "High-energy voice that creates excitement and urgency around every message",
    tone: "Energetic, exciting, urgent. Creates FOMO and momentum. Makes everything feel like an event.",
    style_guidelines: `- Use power words: explosive, massive, incredible
- Create urgency with time pressure
- Stack benefits rapidly
- Use ALL CAPS strategically
- Short sentences. Punchy. Direct.
- Build anticipation with "But wait..."
- End with strong calls to action`,
    visual_template: "bold",
    mood_keywords: ["energetic", "exciting", "urgent", "dynamic", "powerful"]
  },
  {
    id: "voice-calm-closer",
    name: "Calm Closer",
    description: "Soft-sell voice that builds trust through patience, transparency, and genuine helpfulness",
    tone: "Calm, reassuring, trustworthy. No pressure, no hype. Lets the value speak for itself.",
    style_guidelines: `- Lead with empathy and understanding
- Acknowledge objections openly
- Use "No pressure, but..." framing
- Provide genuine value first
- Be transparent about limitations
- Let testimonials do heavy lifting
- Soft CTAs: "When you're ready..."`,
    visual_template: "minimal",
    mood_keywords: ["calm", "trustworthy", "genuine", "patient", "honest"]
  }
];

// =============================================================================
// CHARACTERS (for UGC and video content)
// =============================================================================

export const starterCharacters: StarterCharacter[] = [
  {
    id: "char-everyday-sarah",
    name: "Everyday Sarah",
    description: "Relatable everywoman who represents your typical customer discovering a solution",
    gender: "female",
    age_range: "28-35",
    ethnicity: "Caucasian",
    build: "Average",
    hair_description: "Shoulder-length brown hair, often in a casual ponytail or loose waves",
    typical_clothing: "Casual-smart: jeans, nice blouse, minimal jewelry. Looks put-together but not overdressed",
    overall_tone: "Warm, relatable, genuine",
    speaking_style: "Conversational, uses everyday language, occasional self-deprecating humor",
    personality_traits: ["relatable", "honest", "slightly skeptical at first", "enthusiastic when convinced"],
    tags: ["ugc", "testimonial", "female", "millennial"],
    reference_images: [
      `${ACA_ASSETS_URL}/character-images/Seed%20character%20images/Everyday%20Sarah/Gemini_Generated_Image_76dzd776dzd776dz.png`,
      `${ACA_ASSETS_URL}/character-images/Seed%20character%20images/Everyday%20Sarah/Gemini_Generated_Image_7i3qu67i3qu67i3q%20(2).png`,
      `${ACA_ASSETS_URL}/character-images/Seed%20character%20images/Everyday%20Sarah/Gemini_Generated_Image_c157kcc157kcc157.png`,
      `${ACA_ASSETS_URL}/character-images/Seed%20character%20images/Everyday%20Sarah/Gemini_Generated_Image_xd19z9xd19z9xd19%20(1).png`
    ]
  },
  {
    id: "char-skeptic-mike",
    name: "Skeptic Mike",
    description: "The doubter who becomes a believer - perfect for objection-handling content",
    gender: "male",
    age_range: "35-45",
    ethnicity: "Caucasian",
    build: "Average to athletic",
    hair_description: "Short dark hair, slightly graying at temples, well-groomed stubble",
    typical_clothing: "Business casual: button-down shirts, chinos, leather watch",
    overall_tone: "Initially skeptical, analytical, then genuinely impressed",
    speaking_style: "Direct, asks tough questions, appreciates straight answers",
    personality_traits: ["skeptical", "analytical", "fair-minded", "honest about being wrong"],
    tags: ["ugc", "testimonial", "male", "objection-handler"],
    reference_images: [
      `${ACA_ASSETS_URL}/character-images/Seed%20character%20images/Mike/Gemini_Generated_Image_70bcbx70bcbx70bc%20(1).png`,
      `${ACA_ASSETS_URL}/character-images/Seed%20character%20images/Mike/Gemini_Generated_Image_7cb94w7cb94w7cb9%20(1).png`,
      `${ACA_ASSETS_URL}/character-images/Seed%20character%20images/Mike/Gemini_Generated_Image_7cb94w7cb94w7cb9.png`,
      `${ACA_ASSETS_URL}/character-images/Seed%20character%20images/Mike/Gemini_Generated_Image_bz6wi0bz6wi0bz6w.png`,
      `${ACA_ASSETS_URL}/character-images/Seed%20character%20images/Mike/Gemini_Generated_Image_x9tov0x9tov0x9to%20(1).png`
    ]
  },
  {
    id: "char-expert-david",
    name: "Expert David",
    description: "Authoritative professional who lends credibility to technical or complex topics",
    gender: "male",
    age_range: "40-55",
    ethnicity: "Caucasian",
    build: "Average",
    hair_description: "Salt and pepper hair, neatly styled, professional appearance",
    typical_clothing: "Professional: blazer, dress shirt, sometimes glasses for the expert look",
    overall_tone: "Knowledgeable, trustworthy, measured",
    speaking_style: "Clear explanations, uses analogies, avoids jargon unless necessary",
    personality_traits: ["authoritative", "patient", "thorough", "credible"],
    tags: ["expert", "authority", "male", "professional"],
    reference_images: [
      `${ACA_ASSETS_URL}/character-images/Seed%20character%20images/David/Gemini_Generated_Image_bkz8hjbkz8hjbkz8.png`,
      `${ACA_ASSETS_URL}/character-images/Seed%20character%20images/David/Gemini_Generated_Image_pmoucqpmoucqpmou.png`,
      `${ACA_ASSETS_URL}/character-images/Seed%20character%20images/David/Gemini_Generated_Image_vjn4rlvjn4rlvjn4.png`,
      `${ACA_ASSETS_URL}/character-images/Seed%20character%20images/David/Gemini_Generated_Image_wz5ljwwz5ljwwz5l.png`
    ]
  },
  {
    id: "char-success-jessica",
    name: "Success Story Jessica",
    description: "The transformation story - shows the after of using your product/service",
    gender: "female",
    age_range: "30-40",
    ethnicity: "Mixed/Latina",
    build: "Fit and confident",
    hair_description: "Long dark hair, well-styled, polished appearance",
    typical_clothing: "Successful professional: blazers, designer touches, confident style",
    overall_tone: "Confident, grateful, inspiring",
    speaking_style: "Enthusiastic about results, specific about the journey, motivating",
    personality_traits: ["confident", "grateful", "specific", "motivating"],
    tags: ["ugc", "testimonial", "female", "success-story", "transformation"],
    reference_images: [
      `${ACA_ASSETS_URL}/character-images/Seed%20character%20images/Jessica/Gemini_Generated_Image_59zjcz59zjcz59zj.png`,
      `${ACA_ASSETS_URL}/character-images/Seed%20character%20images/Jessica/Gemini_Generated_Image_r827jrr827jrr827.png`,
      `${ACA_ASSETS_URL}/character-images/Seed%20character%20images/Jessica/Gemini_Generated_Image_u70zbxu70zbxu70z.png`
    ]
  },
  {
    id: "char-busy-entrepreneur",
    name: "Busy Entrepreneur Alex",
    description: "Time-strapped business owner who needs solutions that just work",
    gender: "male",
    age_range: "30-40",
    ethnicity: "Asian",
    build: "Slim",
    hair_description: "Modern short haircut, always looks like he's between meetings",
    typical_clothing: "Smart casual: quality basics, Apple Watch, AirPods often visible",
    overall_tone: "Energetic, time-conscious, results-focused",
    speaking_style: "Gets to the point quickly, appreciates efficiency, speaks in outcomes",
    personality_traits: ["busy", "ambitious", "practical", "results-oriented"],
    tags: ["ugc", "entrepreneur", "male", "business-owner"],
    reference_images: [
      `${ACA_ASSETS_URL}/character-images/Seed%20character%20images/Alex/Gemini_Generated_Image_1qqe8l1qqe8l1qqe.png`,
      `${ACA_ASSETS_URL}/character-images/Seed%20character%20images/Alex/Gemini_Generated_Image_2waz5z2waz5z2waz.png`,
      `${ACA_ASSETS_URL}/character-images/Seed%20character%20images/Alex/Gemini_Generated_Image_lxi95clxi95clxi9.png`,
      `${ACA_ASSETS_URL}/character-images/Seed%20character%20images/Alex/Gemini_Generated_Image_rqy3horqy3horqy3.png`
    ]
  },
  {
    id: "char-mom-melissa",
    name: "Working Mom Melissa",
    description: "Balancing career and family, needs solutions that simplify her life",
    gender: "female",
    age_range: "32-42",
    ethnicity: "African American",
    build: "Average",
    hair_description: "Natural hair in professional styles, varies between straightened and natural curls",
    typical_clothing: "Practical but stylish: comfortable professional wear that transitions from office to home",
    overall_tone: "Warm, practical, appreciative of time-savers",
    speaking_style: "Balances professional and personal, often references juggling responsibilities",
    personality_traits: ["organized", "warm", "practical", "appreciative"],
    tags: ["ugc", "testimonial", "female", "parent", "working-professional"],
    reference_images: [
      `${ACA_ASSETS_URL}/character-images/Seed%20character%20images/Melissa/Gemini_Generated_Image_85eb8v85eb8v85eb.png`,
      `${ACA_ASSETS_URL}/character-images/Seed%20character%20images/Melissa/Gemini_Generated_Image_e70522e70522e705.png`,
      `${ACA_ASSETS_URL}/character-images/Seed%20character%20images/Melissa/Gemini_Generated_Image_ng6tpjng6tpjng6t.png`,
      `${ACA_ASSETS_URL}/character-images/Seed%20character%20images/Melissa/Gemini_Generated_Image_w7gwimw7gwimw7gw.png`
    ]
  }
];

// =============================================================================
// ICPs (Ideal Customer Profiles)
// =============================================================================

export const starterICPs: StarterICP[] = [
  {
    id: "icp-course-creator",
    name: "Course Creator / Info Product Seller",
    description: "Sells digital courses, coaching programs, or information products. Needs constant content for launches and student engagement.",
    pain_points: [
      "Content creation for launches is exhausting",
      "Running out of ideas for student materials",
      "Social media demands constant feeding",
      "Email sequences take forever to write",
      "Can't afford to hire a full content team",
      "Quality drops when trying to scale content output"
    ],
    desires: [
      "Automated content pipeline for launches",
      "Fresh content ideas on demand",
      "Repurpose existing content into new formats",
      "Maintain personal brand voice at scale",
      "More time for high-touch student interaction",
      "Content that converts followers to buyers"
    ],
    objections: [
      "Will it sound like me or like a robot?",
      "My audience will know it's AI",
      "I need very specific, niche content",
      "How does it handle my unique teaching style?"
    ],
    language_style: "Enthusiastic, value-focused. Speaks about transformations, student results, launches, funnels.",
    tags: ["creator", "coach", "digital-products", "b2c"]
  },
  {
    id: "icp-ecom-brand",
    name: "E-commerce Brand Owner",
    description: "Runs a DTC or e-commerce brand. Needs product content, ads, and social proof at scale.",
    pain_points: [
      "UGC is expensive and hard to source",
      "Ad creative fatigue kills campaigns",
      "Product descriptions are boring and don't convert",
      "Need constant fresh content for social",
      "Competitors seem to have unlimited content",
      "Seasonal launches require massive content sprints"
    ],
    desires: [
      "Unlimited ad variations for testing",
      "UGC-style content without paying creators",
      "Product content that actually sells",
      "Consistent brand voice across all channels",
      "Faster time-to-market for new products",
      "Content that stops the scroll"
    ],
    objections: [
      "Can AI create authentic-looking UGC?",
      "Will this work for my specific product niche?",
      "I need high-quality visuals, not just text",
      "How does it handle product-specific details?"
    ],
    language_style: "ROI-focused, talks ROAS, CAC, LTV. Fast-paced, always testing and optimizing.",
    tags: ["ecommerce", "dtc", "retail", "product-based"]
  },
  {
    id: "icp-saas-founder",
    name: "SaaS Founder / Marketing Lead",
    description: "Building or marketing a software product. Needs content for acquisition, onboarding, and retention.",
    pain_points: [
      "Blog content takes too long to produce",
      "Documentation and help content is always outdated",
      "Social presence is inconsistent",
      "Onboarding emails need constant optimization",
      "Feature launches don't get enough content support",
      "Content team is a bottleneck for growth"
    ],
    desires: [
      "SEO content at scale for organic growth",
      "Always-current documentation and guides",
      "Thought leadership content for LinkedIn",
      "Automated onboarding sequences",
      "Feature launch content packages on demand",
      "Technical content that doesn't require engineers"
    ],
    objections: [
      "Can it handle technical product content?",
      "How does it stay current with product changes?",
      "Will it integrate with our existing tools?",
      "Our product is complex - can AI understand it?"
    ],
    language_style: "Technical but accessible. Speaks about MRR, churn, activation, CAC payback. Values systems and automation.",
    tags: ["saas", "b2b", "software", "tech"]
  },
  {
    id: "icp-affiliate-marketer",
    name: "Affiliate Marketer",
    description: "Promotes products for commission. Needs high volume of promotional content across platforms.",
    pain_points: [
      "Need massive volume of review content",
      "SEO competition requires constant content",
      "Can't personally test every product",
      "Ad accounts need fresh creative constantly",
      "Comparison content takes forever to create",
      "Scaling requires hiring writers I can't afford"
    ],
    desires: [
      "Unlimited product review content",
      "SEO-optimized comparison articles",
      "Ad creative variations for testing",
      "Content in multiple formats from one idea",
      "Faster first-mover advantage on new products",
      "Passive content machine for passive income"
    ],
    objections: [
      "Will Google penalize AI content?",
      "Can it write convincing reviews without trying products?",
      "How unique is the content really?",
      "Does it work for my specific niches?"
    ],
    language_style: "ROI-obsessed, talks commissions, EPC, conversion rates. Always looking for the edge.",
    tags: ["affiliate", "performance-marketing", "seo", "content-volume"]
  },
  {
    id: "icp-local-business",
    name: "Local Business Owner",
    description: "Runs a local service business (dental, legal, real estate, etc). Needs content for local SEO and lead generation.",
    pain_points: [
      "Don't have time for social media",
      "Marketing agencies charge too much",
      "Website blog hasn't been updated in years",
      "Competitors are showing up ahead in Google",
      "Don't know what content to create",
      "Can't afford a marketing person"
    ],
    desires: [
      "Show up when locals search for services",
      "Content that generates leads on autopilot",
      "Professional presence without hiring",
      "Easy marketing that doesn't require expertise",
      "Beat competitors in local search",
      "More time for actual service delivery"
    ],
    objections: [
      "I'm not tech-savvy, is this complicated?",
      "Will it work for my local market?",
      "I don't have time to learn new tools",
      "How is this different from what my nephew does?"
    ],
    language_style: "Practical, results-focused. Speaks about leads, appointments, bookings. Values simplicity.",
    tags: ["local", "smb", "service-business", "local-seo"]
  },
  {
    id: "icp-content-creator",
    name: "Content Creator / Influencer",
    description: "Full-time creator on YouTube, TikTok, Instagram, or podcast. Needs constant content across platforms.",
    pain_points: [
      "Algorithm demands constant posting",
      "Creative burnout is real",
      "Can't be on every platform effectively",
      "Repurposing content is tedious",
      "Running out of content ideas",
      "Editing and production takes forever"
    ],
    desires: [
      "Content ideas that never run dry",
      "One piece of content into 10 formats",
      "Maintain posting schedule without burnout",
      "Be everywhere without working 24/7",
      "More time for high-production hero content",
      "Authentic content at scale"
    ],
    objections: [
      "My audience follows me for ME, not AI",
      "Will it understand my style and humor?",
      "I need unique, original ideas not generic content",
      "How do I maintain authenticity?"
    ],
    language_style: "Casual, creative. Talks views, engagement, brand deals, community. Values authenticity and connection.",
    tags: ["creator", "influencer", "personal-brand", "social-media"]
  },
  {
    id: "icp-consultant-coach",
    name: "Consultant / Coach",
    description: "Sells expertise through 1:1 or group coaching, consulting engagements. Needs content to establish authority and generate leads.",
    pain_points: [
      "Feast or famine client cycle",
      "Not enough time for marketing between client work",
      "Know expertise but struggle to package it as content",
      "LinkedIn feels like a full-time job",
      "Lead gen content competes with billable hours",
      "Inconsistent posting kills momentum"
    ],
    desires: [
      "Steady stream of inbound leads",
      "Position as the obvious expert choice",
      "Content that pre-sells and pre-qualifies",
      "Marketing that runs while serving clients",
      "Thought leadership without thought leadership effort",
      "Turn existing knowledge into infinite content"
    ],
    objections: [
      "My expertise is highly specialized",
      "Clients hire me for my personal touch",
      "Will AI content diminish my premium positioning?",
      "I need very nuanced, expert-level content"
    ],
    language_style: "Professional, value-focused. Speaks about transformations, ROI of working together, expertise. Values positioning.",
    tags: ["coach", "consultant", "expert", "high-ticket", "b2b"]
  },
  {
    id: "icp-real-estate-agent",
    name: "Real Estate Agent / Team Lead",
    description: "Real estate professional needing constant local content for listings, market updates, and personal brand building.",
    pain_points: [
      "Listings need fresh content constantly",
      "Local market content takes hours to research and write",
      "Standing out in a crowded agent market",
      "Social media presence feels like a second job",
      "Video content for listings is time-consuming",
      "Can't keep up with content demands while showing properties"
    ],
    desires: [
      "Automated listing descriptions and social posts",
      "Local market expertise content on autopilot",
      "Video scripts for property tours and market updates",
      "Personal brand content that attracts ideal clients",
      "Email nurture sequences that convert leads",
      "More time for client relationships and closings"
    ],
    objections: [
      "Real estate is hyper-local, can AI understand my market?",
      "My clients expect personal touch, not automated content",
      "Compliance and fair housing concerns with AI content",
      "Will it work with my MLS data and property info?"
    ],
    language_style: "Friendly, local-focused. Speaks about neighborhoods, market trends, dream homes. Values relationships and trust.",
    tags: ["real-estate", "local-business", "agent", "b2c"]
  },
  {
    id: "icp-newsletter-creator",
    name: "Newsletter Creator / Publisher",
    description: "Runs a paid or free newsletter. Needs consistent, high-quality content to grow and retain subscribers.",
    pain_points: [
      "Weekly publishing deadlines are relentless",
      "Research and writing takes 20+ hours per issue",
      "Subscriber growth has plateaued",
      "Monetization requires even more content",
      "Can't take time off without missing issues",
      "Quality suffers when rushing to meet deadlines"
    ],
    desires: [
      "Cut research and writing time in half",
      "Consistent quality regardless of schedule",
      "More content variations for A/B testing",
      "Repurpose newsletter content across platforms",
      "Build content buffer for vacations",
      "Scale to multiple newsletters or editions"
    ],
    objections: [
      "My subscribers pay for MY voice and perspective",
      "Newsletter space is crowded, AI will make it worse",
      "Can it maintain the depth my readers expect?",
      "How do I keep my unique editorial angle?"
    ],
    language_style: "Editorial, opinionated. Speaks about open rates, subscriber growth, sponsorships, content quality. Values consistency.",
    tags: ["newsletter", "creator", "media", "subscription"]
  },
  {
    id: "icp-podcast-host",
    name: "Podcast Host / Producer",
    description: "Runs a podcast and needs supporting content - show notes, social clips, email newsletters, and promotional material.",
    pain_points: [
      "Show notes take hours after each recording",
      "Promoting episodes across platforms is exhausting",
      "Repurposing audio into written content is tedious",
      "Guest outreach and prep materials need constant updating",
      "Newsletter to accompany podcast is always behind",
      "No time for YouTube descriptions, blog posts, social clips"
    ],
    desires: [
      "Automated show notes from transcripts",
      "Social media content for each episode",
      "Guest pitch templates and research summaries",
      "Newsletter content derived from episodes",
      "SEO-optimized blog posts from audio content",
      "More time for recording and guest relationships"
    ],
    objections: [
      "My podcast has a specific tone AI might miss",
      "Show notes need to capture actual conversation points",
      "Will it work with my podcast format and style?",
      "I need human nuance in guest communications"
    ],
    language_style: "Conversational, community-focused. Speaks about downloads, listens, sponsors, guest bookings. Values connection.",
    tags: ["podcast", "creator", "audio", "media"]
  },
  {
    id: "icp-fitness-wellness",
    name: "Fitness Coach / Wellness Brand",
    description: "Personal trainer, gym owner, or wellness brand needing content for programs, motivation, and client results.",
    pain_points: [
      "Program content needs constant refreshing",
      "Motivational content feels repetitive",
      "Client check-in messages take too much time",
      "Social proof and transformation stories need writing",
      "Can't keep up with daily social posting",
      "Email sequences for challenges and programs are overwhelming"
    ],
    desires: [
      "Workout descriptions and program content at scale",
      "Fresh motivational content daily",
      "Client success story templates",
      "Challenge and program launch content",
      "Educational content about fitness topics",
      "More time for actual training and client support"
    ],
    objections: [
      "Fitness content needs to be technically accurate",
      "My personality is key to my brand",
      "Will it understand different fitness modalities?",
      "Clients expect personalized motivation"
    ],
    language_style: "Energetic, motivational. Speaks about gains, transformations, consistency, wellness. Values results and community.",
    tags: ["fitness", "wellness", "coach", "health", "b2c"]
  },
  {
    id: "icp-lawyer-professional",
    name: "Lawyer / Professional Services",
    description: "Attorney or professional service provider needing content for thought leadership, lead generation, and client education.",
    pain_points: [
      "Billable hour pressure leaves no time for marketing",
      "Content needs to be accurate and compliant",
      "Establishing expertise takes consistent publishing",
      "Blog content is always on the back burner",
      "LinkedIn presence is inconsistent",
      "Client education materials are outdated"
    ],
    desires: [
      "Thought leadership content without the time investment",
      "Compliant, professional content at scale",
      "Educational resources for prospective clients",
      "Consistent LinkedIn presence for referrals",
      "FAQ and resource content for common questions",
      "More time for actual client work"
    ],
    objections: [
      "Legal content requires precision and compliance",
      "AI might not understand jurisdiction-specific nuances",
      "Professional reputation is on the line",
      "Content needs to reflect my expertise, not generic advice"
    ],
    language_style: "Professional, authoritative. Speaks about cases, outcomes, expertise, client service. Values precision and reputation.",
    tags: ["legal", "professional-services", "b2b", "high-ticket"]
  },
  {
    id: "icp-restaurant-hospitality",
    name: "Restaurant / Hospitality Owner",
    description: "Restaurant, hotel, or hospitality business needing constant content for menus, promotions, and local marketing.",
    pain_points: [
      "Menu descriptions need constant updating",
      "Social media feels like a full-time job",
      "Event and promotion content needed weekly",
      "Reviews and responses take too much time",
      "Seasonal content planning is overwhelming",
      "No budget for a marketing person"
    ],
    desires: [
      "Mouth-watering menu descriptions on demand",
      "Social content that drives foot traffic",
      "Event and promotion materials quickly",
      "Review response templates that feel personal",
      "Email campaigns for specials and events",
      "More time for operations and guest experience"
    ],
    objections: [
      "My restaurant has a unique vibe AI might miss",
      "Food content needs to be appetizing and specific",
      "Local references and personality are important",
      "Will it work for our type of cuisine and atmosphere?"
    ],
    language_style: "Warm, inviting. Speaks about flavors, experiences, ambiance, community. Values hospitality and connection.",
    tags: ["restaurant", "hospitality", "local-business", "food"]
  },
  {
    id: "icp-nonprofit-org",
    name: "Nonprofit / Cause-Based Organization",
    description: "Nonprofit or cause-based organization needing compelling content for fundraising, awareness, and donor engagement.",
    pain_points: [
      "Grant applications and reports take forever",
      "Donor communications feel repetitive",
      "Impact stories need constant documentation",
      "Social media competes with program work",
      "Email fundraising campaigns need fresh angles",
      "Limited budget for marketing staff"
    ],
    desires: [
      "Compelling impact stories on demand",
      "Grant application content and templates",
      "Donor thank-you and update communications",
      "Fundraising campaign content that converts",
      "Social content that drives awareness",
      "More time for actual mission work"
    ],
    objections: [
      "Our cause needs authentic, emotional storytelling",
      "Donors expect genuine communication",
      "Grant applications have specific requirements",
      "Will it understand our mission and impact?"
    ],
    language_style: "Mission-driven, emotional. Speaks about impact, community, change, gratitude. Values authenticity and purpose.",
    tags: ["nonprofit", "cause", "fundraising", "b2c"]
  }
];

// =============================================================================
// PRODUCT TEMPLATES
// =============================================================================

export const starterProducts: StarterProduct[] = [
  {
    id: "product-saas-template",
    name: "[SaaS Product Template]",
    description: "Template for software-as-a-service products. Replace bracketed items with your specifics.",
    category: "SaaS / Software",
    features: [
      "[Core feature 1 - what it does]",
      "[Core feature 2 - what it does]",
      "[Core feature 3 - what it does]",
      "[Integration capability]",
      "[Automation feature]",
      "[Analytics/reporting feature]"
    ],
    key_benefits: [
      "Save [X] hours per [time period]",
      "Reduce [pain point] by [percentage]",
      "Increase [desired outcome] by [amount]",
      "Eliminate [tedious task] completely",
      "Scale [activity] without scaling [resource]"
    ],
    tags: ["template", "saas", "software"]
  },
  {
    id: "product-course-template",
    name: "[Digital Course Template]",
    description: "Template for online courses and educational products. Replace bracketed items with your specifics.",
    category: "Digital Products / Education",
    features: [
      "[Number] modules covering [topic breadth]",
      "[Number] hours of [content type] content",
      "[Bonus 1] - [value description]",
      "[Bonus 2] - [value description]",
      "Lifetime access + updates",
      "[Community/support element]"
    ],
    key_benefits: [
      "Go from [current state] to [desired state]",
      "Learn [skill] in [timeframe]",
      "Avoid [common mistake] that costs [consequence]",
      "Get [result] even if [common objection]",
      "Join [number] students who have [achieved result]"
    ],
    tags: ["template", "course", "digital-product"]
  },
  {
    id: "product-physical-template",
    name: "[Physical Product Template]",
    description: "Template for physical/e-commerce products. Replace bracketed items with your specifics.",
    category: "E-commerce / Physical",
    features: [
      "Made with [material/ingredient]",
      "[Key differentiating feature]",
      "[Size/quantity] specifications",
      "[Quality certification/standard]",
      "[Shipping/delivery detail]",
      "[Warranty/guarantee]"
    ],
    key_benefits: [
      "Finally [solve problem] without [common compromise]",
      "Designed for [specific use case]",
      "[Unique benefit] you won't find in [alternatives]",
      "Lasts [duration] unlike [competitors]",
      "Trusted by [social proof element]"
    ],
    tags: ["template", "ecommerce", "physical-product"]
  },
  {
    id: "product-service-template",
    name: "[Service Offer Template]",
    description: "Template for service-based businesses. Replace bracketed items with your specifics.",
    category: "Services / Done-For-You",
    features: [
      "[Primary deliverable]",
      "[Secondary deliverable]",
      "[Timeline/turnaround]",
      "[Number] of [revisions/iterations]",
      "[Support/communication level]",
      "[Bonus inclusion]"
    ],
    key_benefits: [
      "Get [result] without [effort/learning curve]",
      "Done by [credibility marker] experts",
      "Save [time/money] vs [alternative]",
      "[Guarantee/risk reversal]",
      "Focus on [what they'd rather do] while we handle [service]"
    ],
    tags: ["template", "service", "done-for-you"]
  }
];

// =============================================================================
// BLOCKS (Hooks, CTAs, Angles, etc.)
// =============================================================================

export const starterBlocks: StarterBlock[] = [
  // HOOKS
  {
    id: "block-hook-controversial",
    name: "Controversial Truth",
    block_type: "hook",
    content: "Most [experts/people] won't tell you this, but [controversial truth about industry]...",
    tags: ["hook", "controversy", "pattern-interrupt"]
  },
  {
    id: "block-hook-mistake",
    name: "Costly Mistake",
    block_type: "hook",
    content: "The #1 mistake I see [target audience] make (and it's costing them [consequence]):",
    tags: ["hook", "mistake", "pain-point"]
  },
  {
    id: "block-hook-stopped",
    name: "What I Stopped Doing",
    block_type: "hook",
    content: "I stopped [common practice] 6 months ago. Here's what happened:",
    tags: ["hook", "transformation", "story"]
  },
  {
    id: "block-hook-secret",
    name: "Industry Secret",
    block_type: "hook",
    content: "[Industry] doesn't want you to know this, but [revelation]...",
    tags: ["hook", "secret", "insider"]
  },
  {
    id: "block-hook-comparison",
    name: "Then vs Now",
    block_type: "hook",
    content: "2 years ago: [old struggle]. Today: [new result]. The difference? [single change]",
    tags: ["hook", "transformation", "before-after"]
  },
  {
    id: "block-hook-question",
    name: "Provocative Question",
    block_type: "hook",
    content: "What if everything you knew about [topic] was wrong?",
    tags: ["hook", "question", "curiosity"]
  },

  // ANGLES
  {
    id: "block-angle-contrarian",
    name: "Contrarian Take",
    block_type: "angle",
    content: "While everyone else is [common approach], smart [audience] are doing [different approach] instead. Here's why...",
    tags: ["angle", "contrarian", "differentiation"]
  },
  {
    id: "block-angle-future",
    name: "Future Pacing",
    block_type: "angle",
    content: "In 12 months, you'll either be [negative outcome] or [positive outcome]. The choice you make today determines which.",
    tags: ["angle", "urgency", "future-pacing"]
  },
  {
    id: "block-angle-us-vs-them",
    name: "Us vs Them",
    block_type: "angle",
    content: "There are two types of [audience]: those who [struggle] and those who [succeed]. The difference isn't talent—it's [key factor].",
    tags: ["angle", "tribal", "identity"]
  },
  {
    id: "block-angle-discovery",
    name: "Accidental Discovery",
    block_type: "angle",
    content: "I accidentally discovered this [method/approach] when [circumstance]. Now [impressive result].",
    tags: ["angle", "story", "discovery"]
  },

  // CTAs
  {
    id: "block-cta-soft",
    name: "Soft CTA",
    block_type: "cta",
    content: "When you're ready, here's how I can help: [offer description]",
    tags: ["cta", "soft-sell", "low-pressure"]
  },
  {
    id: "block-cta-direct",
    name: "Direct CTA",
    block_type: "cta",
    content: "Click [link/button] to [get result]. Takes 2 minutes. No credit card required.",
    tags: ["cta", "direct", "action"]
  },
  {
    id: "block-cta-scarcity",
    name: "Scarcity CTA",
    block_type: "cta",
    content: "Only [number] spots left this [time period]. [Link] to claim yours before they're gone.",
    tags: ["cta", "scarcity", "urgency"]
  },
  {
    id: "block-cta-social-proof",
    name: "Social Proof CTA",
    block_type: "cta",
    content: "Join [number]+ [audience] who have already [achieved result]. [Link]",
    tags: ["cta", "social-proof", "fomo"]
  },
  {
    id: "block-cta-risk-reversal",
    name: "Risk Reversal CTA",
    block_type: "cta",
    content: "Try it risk-free for [time period]. If you don't [get result], you pay nothing. [Link]",
    tags: ["cta", "guarantee", "risk-reversal"]
  },

  // STORY ELEMENTS
  {
    id: "block-story-origin",
    name: "Origin Story Opening",
    block_type: "story_element",
    content: "Three years ago, I was [relatable struggle]. I'd tried [failed attempts]. Nothing worked. Then [turning point]...",
    tags: ["story", "origin", "relatability"]
  },
  {
    id: "block-story-transformation",
    name: "Transformation Arc",
    block_type: "story_element",
    content: "Before: [specific pain/situation]. The moment everything changed: [catalyst]. After: [specific result with proof].",
    tags: ["story", "transformation", "before-after"]
  },
  {
    id: "block-story-lesson",
    name: "Lesson Learned",
    block_type: "story_element",
    content: "I learned this the hard way so you don't have to: [lesson]. Here's what happened: [brief story]...",
    tags: ["story", "lesson", "education"]
  },

  // VISUAL STYLES
  {
    id: "block-visual-minimal",
    name: "Minimal Clean",
    block_type: "visual_style",
    content: "Clean white background, sans-serif typography, ample whitespace, single accent color, no decorative elements",
    tags: ["visual", "minimal", "clean"]
  },
  {
    id: "block-visual-bold",
    name: "Bold Impact",
    block_type: "visual_style",
    content: "Dark background, large bold typography, high contrast colors, dramatic lighting, strong visual hierarchy",
    tags: ["visual", "bold", "dramatic"]
  },
  {
    id: "block-visual-warm",
    name: "Warm Approachable",
    block_type: "visual_style",
    content: "Soft warm tones, rounded elements, friendly typography, natural textures, inviting and comfortable feel",
    tags: ["visual", "warm", "friendly"]
  }
];

// =============================================================================
// IDEAS (Content idea templates)
// =============================================================================

export const starterIdeas: StarterIdea[] = [
  // AUTHORITY BUILDING
  {
    id: "idea-auth-mistake",
    title: "The #1 mistake I see [target audience] make (and how to fix it)",
    category: "Authority Building",
    tags: ["authority", "education", "mistakes"]
  },
  {
    id: "idea-auth-years",
    title: "What [X] years in [industry] taught me that no course ever will",
    category: "Authority Building",
    tags: ["authority", "experience", "lessons"]
  },
  {
    id: "idea-auth-unpopular",
    title: "Unpopular opinion: [controversial industry take] - here's why",
    category: "Authority Building",
    tags: ["authority", "contrarian", "controversy"]
  },
  {
    id: "idea-auth-fail",
    title: "Here's why most [audience] fail at [goal] (and the simple fix)",
    category: "Authority Building",
    tags: ["authority", "education", "failure"]
  },
  {
    id: "idea-auth-secret",
    title: "The [industry] secret nobody talks about",
    category: "Authority Building",
    tags: ["authority", "insider", "secrets"]
  },

  // SOCIAL PROOF
  {
    id: "idea-social-transformation",
    title: "How [client type] went from [struggle] to [result] in [timeframe]",
    category: "Social Proof",
    tags: ["social-proof", "case-study", "transformation"]
  },
  {
    id: "idea-social-numbers",
    title: "[Number]+ [customers/clients] can't be wrong about [benefit]",
    category: "Social Proof",
    tags: ["social-proof", "numbers", "trust"]
  },
  {
    id: "idea-social-trust",
    title: "Why [credibility marker] trust us with their [outcome]",
    category: "Social Proof",
    tags: ["social-proof", "credibility", "trust"]
  },
  {
    id: "idea-social-result",
    title: "\"I didn't believe it until I saw [specific result]\" - [Client name]",
    category: "Social Proof",
    tags: ["social-proof", "testimonial", "results"]
  },

  // PRODUCT/OFFER
  {
    id: "idea-product-working",
    title: "We've been working on this for [timeframe] - finally ready to share",
    category: "Product Launch",
    tags: ["product", "launch", "announcement"]
  },
  {
    id: "idea-product-feature",
    title: "The feature you've been asking for is finally here",
    category: "Product Launch",
    tags: ["product", "feature", "announcement"]
  },
  {
    id: "idea-product-intro",
    title: "Introducing [product/offer]: The solution to [specific problem]",
    category: "Product Launch",
    tags: ["product", "launch", "solution"]
  },
  {
    id: "idea-product-behind",
    title: "Behind the scenes: How we built [product/feature]",
    category: "Product Launch",
    tags: ["product", "behind-scenes", "story"]
  },

  // OBJECTION HANDLING
  {
    id: "idea-objection-expensive",
    title: "\"It's too expensive\" - Here's what you're really paying for",
    category: "Objection Handling",
    tags: ["objection", "price", "value"]
  },
  {
    id: "idea-objection-time",
    title: "\"I don't have time\" - This takes less than [X] minutes a day",
    category: "Objection Handling",
    tags: ["objection", "time", "simplicity"]
  },
  {
    id: "idea-objection-tried",
    title: "\"I've tried everything\" - Here's why this is different",
    category: "Objection Handling",
    tags: ["objection", "differentiation", "unique"]
  },
  {
    id: "idea-objection-not-for-me",
    title: "\"This isn't for me\" - You might be surprised",
    category: "Objection Handling",
    tags: ["objection", "targeting", "inclusion"]
  },
  {
    id: "idea-objection-later",
    title: "\"I'll do it later\" - The real cost of waiting",
    category: "Objection Handling",
    tags: ["objection", "urgency", "procrastination"]
  },

  // EDUCATION/HOW-TO
  {
    id: "idea-howto-guide",
    title: "The complete guide to [topic] in [timeframe]",
    category: "Education",
    tags: ["education", "guide", "how-to"]
  },
  {
    id: "idea-howto-steps",
    title: "[Number] steps to [desired outcome] (step-by-step breakdown)",
    category: "Education",
    tags: ["education", "steps", "tutorial"]
  },
  {
    id: "idea-howto-without",
    title: "How to [achieve result] without [common sacrifice]",
    category: "Education",
    tags: ["education", "how-to", "easy"]
  },
  {
    id: "idea-howto-tools",
    title: "The exact [tools/process] I use to [achieve result]",
    category: "Education",
    tags: ["education", "tools", "process"]
  },
  {
    id: "idea-howto-beginner",
    title: "[Topic] for beginners: Everything you need to know to start",
    category: "Education",
    tags: ["education", "beginner", "starter"]
  },

  // ENGAGEMENT DRIVERS
  {
    id: "idea-engage-challenge",
    title: "What's your biggest challenge with [topic]? Drop it below",
    category: "Engagement",
    tags: ["engagement", "question", "community"]
  },
  {
    id: "idea-engage-hottake",
    title: "Hot take: [controversial statement]. Agree or disagree?",
    category: "Engagement",
    tags: ["engagement", "controversy", "debate"]
  },
  {
    id: "idea-engage-change",
    title: "If you could change one thing about [industry/topic], what would it be?",
    category: "Engagement",
    tags: ["engagement", "question", "community"]
  },
  {
    id: "idea-engage-unpopular",
    title: "Give me your most unpopular [industry] opinion",
    category: "Engagement",
    tags: ["engagement", "controversy", "community"]
  },

  // STORYTELLING
  {
    id: "idea-story-changed",
    title: "The day everything changed for my [business/career/life]",
    category: "Storytelling",
    tags: ["story", "transformation", "personal"]
  },
  {
    id: "idea-story-gaveup",
    title: "I almost gave up on [goal] - until this happened",
    category: "Storytelling",
    tags: ["story", "perseverance", "turning-point"]
  },
  {
    id: "idea-story-journey",
    title: "From [struggle/starting point] to [success]: My journey",
    category: "Storytelling",
    tags: ["story", "transformation", "journey"]
  },
  {
    id: "idea-story-lesson",
    title: "The $[X] lesson I learned the hard way so you don't have to",
    category: "Storytelling",
    tags: ["story", "lesson", "mistake"]
  },
  {
    id: "idea-story-fired",
    title: "Getting [fired/rejected/failed] was the best thing that happened to me",
    category: "Storytelling",
    tags: ["story", "adversity", "growth"]
  },

  // URGENCY/SCARCITY
  {
    id: "idea-urgency-lastchance",
    title: "Last chance to [benefit] before [deadline/price increase]",
    category: "Urgency",
    tags: ["urgency", "deadline", "offer"]
  },
  {
    id: "idea-urgency-spots",
    title: "Only [number] spots remaining for [offer] - here's who it's for",
    category: "Urgency",
    tags: ["urgency", "scarcity", "limited"]
  },
  {
    id: "idea-urgency-price",
    title: "The price is going up [timeframe] - here's why (and why now)",
    category: "Urgency",
    tags: ["urgency", "price", "deadline"]
  },
  {
    id: "idea-urgency-closing",
    title: "Doors close [timeframe]: What you need to know before deciding",
    category: "Urgency",
    tags: ["urgency", "deadline", "decision"]
  }
];

// =============================================================================
// EXPORT ALL
// =============================================================================

export const starterPackData = {
  brandVoices: starterBrandVoices,
  characters: starterCharacters,
  icps: starterICPs,
  products: starterProducts,
  blocks: starterBlocks,
  ideas: starterIdeas
};

export type StarterPackCategory = 'brandVoices' | 'characters' | 'icps' | 'products' | 'blocks' | 'ideas';

export function getStarterPackCounts() {
  return {
    brandVoices: starterBrandVoices.length,
    characters: starterCharacters.length,
    icps: starterICPs.length,
    products: starterProducts.length,
    blocks: starterBlocks.length,
    ideas: starterIdeas.length,
    total: starterBrandVoices.length + starterCharacters.length + starterICPs.length + starterProducts.length + starterBlocks.length + starterIdeas.length
  };
}
