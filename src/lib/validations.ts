import { z } from "zod";

// Platform-specific validation schemas
export const youtubeCreatorSchema = z.object({
  platform: z.literal("youtube"),
  channelUrl: z
    .string()
    .min(1, "Channel URL is required")
    .refine(
      (url) =>
        url.includes("youtube.com/@") ||
        url.includes("youtube.com/channel/") ||
        url.includes("youtube.com/c/"),
      "Must be a valid YouTube channel URL"
    ),
  displayName: z.string().optional(),
  tags: z.array(z.string()).optional(),
  notes: z.string().optional(),
  scrapeImmediately: z.boolean().default(false),
  scrapeConfig: z
    .object({
      postsCount: z.number().min(1).max(500),
      shortsCount: z.number().min(0).max(500).optional(),
      daysBack: z.number().min(1).optional(),
    })
    .optional(),
});

export const instagramCreatorSchema = z.object({
  platform: z.literal("instagram"),
  username: z
    .string()
    .min(1, "Username is required")
    .max(30, "Username must be 30 characters or less")
    .regex(/^[a-zA-Z0-9_.]+$/, "Username can only contain letters, numbers, underscores, and periods")
    .refine((username) => !username.startsWith("@"), "Don't include the @ symbol"),
  displayName: z.string().optional(),
  tags: z.array(z.string()).optional(),
  notes: z.string().optional(),
  scrapeImmediately: z.boolean().default(false),
  scrapeConfig: z
    .object({
      postsCount: z.number().min(1).max(500),
      daysBack: z.number().min(1).optional(),
    })
    .optional(),
});

export const tiktokCreatorSchema = z.object({
  platform: z.literal("tiktok"),
  username: z
    .string()
    .min(2, "Username must be at least 2 characters")
    .max(24, "Username must be 24 characters or less")
    .regex(/^[a-zA-Z0-9_.]+$/, "Username can only contain letters, numbers, underscores, and periods")
    .refine((username) => !username.startsWith("@"), "Don't include the @ symbol"),
  displayName: z.string().optional(),
  tags: z.array(z.string()).optional(),
  notes: z.string().optional(),
  scrapeImmediately: z.boolean().default(false),
  scrapeConfig: z
    .object({
      postsCount: z.number().min(1).max(500),
      daysBack: z.number().min(1).optional(),
    })
    .optional(),
});

export const linkedinCreatorSchema = z.object({
  platform: z.literal("linkedin"),
  profileUrl: z
    .string()
    .min(1, "Profile URL is required")
    .refine(
      (url) => url.includes("linkedin.com/in/"),
      "Must be a valid LinkedIn profile URL"
    ),
  displayName: z.string().optional(),
  tags: z.array(z.string()).optional(),
  notes: z.string().optional(),
  scrapeImmediately: z.boolean().default(false),
  scrapeConfig: z
    .object({
      postsCount: z.number().min(1).max(500),
      daysBack: z.number().min(1).optional(),
    })
    .optional(),
});

export const twitterCreatorSchema = z.object({
  platform: z.literal("twitter"),
  username: z
    .string()
    .min(1, "Handle is required")
    .max(15, "X handles must be 15 characters or less")
    .regex(/^[a-zA-Z0-9_]+$/, "Handle can only contain letters, numbers, and underscores")
    .refine((username) => !username.startsWith("@"), "Don't include the @ symbol"),
  displayName: z.string().optional(),
  tags: z.array(z.string()).optional(),
  notes: z.string().optional(),
  scrapeImmediately: z.boolean().default(false),
  scrapeConfig: z
    .object({
      postsCount: z.number().min(1).max(500),
      daysBack: z.number().min(1).optional(),
    })
    .optional(),
});

export const creatorSchema = z.discriminatedUnion("platform", [
  youtubeCreatorSchema,
  instagramCreatorSchema,
  tiktokCreatorSchema,
  linkedinCreatorSchema,
  twitterCreatorSchema,
]);

export const searchTermSchema = z.object({
  searchTerm: z.string().min(1, "Search term is required").max(200, "Search term is too long"),
  platform: z.enum(["youtube", "tiktok", "linkedin", "instagram", "twitter"], {
    required_error: "Please select a platform",
  }),
  tags: z.array(z.string()).optional(),
  notes: z.string().optional(),
  scrapeImmediately: z.boolean().default(false),
  maxResults: z.number().min(1).max(100).optional(),
});

export type CreatorFormData = z.infer<typeof creatorSchema>;
export type SearchTermFormData = z.infer<typeof searchTermSchema>;

// API Key validation schemas
export const apiKeySchema = z.object({
  provider: z.enum([
    // Content generation
    'openrouter', 'ollama', 'alibaba', 'openai', 'replicate', 'elevenlabs', 'fal', 'heygen', 'pexels',
    // Data & scraping
    'apify', 'youtube',
    // CRM & social
    'leadconnector', 'unipile',
    // Contact enrichment
    'apollo', 'hunter', 'prospeo', 'moltsets', 'quickenrich',
    // Email infrastructure
    'zapmail',
    // Email verification
    'mailtester_ninja',
    // Domain registrars
    'porkbun',
  ], {
    required_error: 'Please select a provider',
  }),
  // Ollama self-hosted servers may have no auth, so the key is optional there
  // (enforced via refine below); every other provider requires a real key.
  apiKey: z.string().max(1000, 'API key is too long'),
  capability: z.string().optional(),
  // Shared field, repurposed per-provider: a server URL for Ollama/Unipile,
  // or a region enum ('intl' | 'cn') for Alibaba — format enforced by the
  // per-provider refines below rather than a single global shape.
  dsnUrl: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().optional(),
  ),
  secondaryKey: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().min(1).optional(),
  ),
  // Plan tier — drives client-side rate limiting + daily cap. Mailtester
  // Ninja (see _shared/list-verifier.ts MAILTESTER_PLAN_LIMITS), MoltSets
  // (see _shared/enrichment/moltsets.ts MOLTSETS_PLAN_LIMITS), and QuickEnrich
  // (see _shared/enrichment/quickenrich.ts QUICKENRICH_PLAN_LIMITS) share this
  // field; each provider only recognizes its own tier values.
  plan: z.enum(['starter', 'growth', 'pro', 'ultimate', 'tier_27', 'tier_97', 'tier_997', 'standard', 'gtm_unlimited']).optional(),
  requestsPerMinute: z.preprocess(
    (val) => (val === '' || val === undefined ? undefined : Number(val)),
    z.number().int().min(1).max(100_000).optional(),
  ),
}).refine(
  (data) => data.provider === 'ollama' || data.apiKey.length >= 10,
  { message: 'API key is too short', path: ['apiKey'] }
).refine(
  // Ollama: either a Cloud API key or a self-hosted server URL must be given
  (data) => data.provider !== 'ollama' || data.apiKey.length >= 10 || (data.dsnUrl && data.dsnUrl.length > 0),
  { message: 'Enter an Ollama Cloud API key, or a self-hosted server URL', path: ['apiKey'] }
).refine(
  (data) => !['ollama', 'unipile'].includes(data.provider) || !data.dsnUrl || /^https?:\/\/.+/.test(data.dsnUrl),
  { message: 'Must be a valid URL', path: ['dsnUrl'] }
).refine(
  // 'intl'/'cn' are region shorthands; anything else must be a full URL
  // (a dedicated/workspace deployment endpoint).
  (data) => data.provider !== 'alibaba' || !data.dsnUrl || ['intl', 'cn'].includes(data.dsnUrl) || /^https?:\/\/.+/.test(data.dsnUrl),
  { message: 'Select a region or enter a valid endpoint URL', path: ['dsnUrl'] }
).refine(
  (data) => data.provider !== 'porkbun' || (data.secondaryKey && data.secondaryKey.length > 0),
  { message: 'Secondary credential is required for domain registrars', path: ['secondaryKey'] }
).refine(
  (data) => data.provider !== 'mailtester_ninja' || !!data.plan,
  { message: 'Plan tier is required for Mailtester Ninja', path: ['plan'] }
).refine(
  (data) => data.provider !== 'moltsets' || !!data.plan,
  { message: 'Plan tier is required for MoltSets', path: ['plan'] }
).refine(
  (data) => data.provider !== 'quickenrich' || ['standard', 'gtm_unlimited'].includes(data.plan ?? ''),
  { message: 'Plan tier is required for QuickEnrich', path: ['plan'] }
).refine(
  (data) => data.provider !== 'prospeo' || ['starter', 'growth', 'pro'].includes(data.plan ?? ''),
  { message: 'Plan tier is required for Prospeo', path: ['plan'] }
).refine(
  (data) => data.provider !== 'apollo' || !!data.requestsPerMinute,
  { message: 'Enter the People Enrichment requests-per-minute limit from Apollo', path: ['requestsPerMinute'] }
);

// Storage credentials validation schemas
export const cloudflareR2Schema = z.object({
  provider: z.literal('cloudflare_r2'),
  accountId: z.string().min(1, 'Account ID is required'),
  accessKeyId: z.string().min(1, 'Access Key ID is required'),
  secretAccessKey: z.string().min(1, 'Secret Access Key is required'),
  bucketName: z.string().min(1, 'Bucket name is required'),
  publicUrl: z.string().url('Public URL must be a valid URL').min(1, 'Public URL is required for R2'),
});

export const awsS3Schema = z.object({
  provider: z.literal('aws_s3'),
  accessKeyId: z.string().min(1, 'Access Key ID is required'),
  secretAccessKey: z.string().min(1, 'Secret Access Key is required'),
  region: z.string().min(1, 'Region is required'),
  bucketName: z.string().min(1, 'Bucket name is required'),
});

export const backblazeB2Schema = z.object({
  provider: z.literal('backblaze_b2'),
  keyId: z.string().min(1, 'Key ID is required'),
  applicationKey: z.string().min(1, 'Application Key is required'),
  bucketName: z.string().min(1, 'Bucket name is required'),
  bucketId: z.string().min(1, 'Bucket ID is required'),
  endpoint: z.string().url('Invalid endpoint URL'),
});

export const storageCredentialsSchema = z.discriminatedUnion('provider', [
  cloudflareR2Schema,
  awsS3Schema,
  backblazeB2Schema,
]);

export type ApiKeyFormData = z.infer<typeof apiKeySchema>;
export type StorageCredentialsFormData = z.infer<typeof storageCredentialsSchema>;
