import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { apiKeySchema, type ApiKeyFormData } from "@/lib/validations";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAddApiKey } from "@/hooks/useAddApiKey";
import { FUNCTIONS_URL } from "@/config/site";

interface AddApiKeyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultProvider?: string;
}

const PROVIDERS = [
  // Content generation
  { value: "openrouter", label: "OpenRouter (LLM)", description: "For AI text generation", category: "Content Generation" },
  { value: "ollama", label: "Ollama (LLM)", description: "Ollama Cloud or your own Ollama server", category: "Content Generation" },
  { value: "alibaba", label: "Alibaba Cloud (Qwen)", description: "Direct DashScope access to Qwen models — cheaper than routing through OpenRouter", category: "Content Generation" },
  { value: "openai", label: "OpenAI", description: "Direct OpenAI access — required for multiturn carousel image generation (GPT-5.5)", category: "Content Generation" },
  { value: "replicate", label: "Replicate", description: "For video and image generation", category: "Content Generation" },
  { value: "elevenlabs", label: "ElevenLabs", description: "For voice generation", category: "Content Generation" },
  // Data & scraping
  { value: "apify", label: "Apify", description: "For web scraping", category: "Data & Scraping" },
  { value: "youtube", label: "YouTube API", description: "For YouTube content access", category: "Data & Scraping" },
  // CRM & Social
  { value: "leadconnector", label: "LeadConnector", description: "For social media publishing (requires socialplanner/account.readonly scope)", category: "CRM & Social" },
  { value: "unipile", label: "Unipile", description: "For multi-channel messaging (LinkedIn, WhatsApp, Telegram, etc.)", category: "CRM & Social" },
  { value: "zernio", label: "Zernio", description: "Publish from the Scheduler to Facebook, Instagram, TikTok, Google Business, YouTube, Threads and Pinterest", category: "CRM & Social" },
  // Contact enrichment
  { value: "apollo", label: "Apollo.io", description: "Email + phone enrichment from LinkedIn", category: "Contact Enrichment" },
  { value: "hunter", label: "Hunter", description: "Work email finding by name and company domain", category: "Contact Enrichment" },
  { value: "prospeo", label: "Prospeo", description: "Email finder and verification", category: "Contact Enrichment" },
  { value: "moltsets", label: "MoltSets", description: "LinkedIn identity resolution", category: "Contact Enrichment" },
  { value: "quickenrich", label: "QuickEnrich", description: "Email, phone & domain search — similar to MoltSets", category: "Contact Enrichment" },
  // Email infrastructure
  { value: "zapmail", label: "ZapMail", description: "Mailbox provisioning & domain management", category: "Email Infrastructure" },
  // Email verification
  { value: "mailtester_ninja", label: "Mailtester Ninja", description: "Affordable email verification (from $6.99/wk)", category: "Email Verification" },
  // UGC video
  { value: "heygen", label: "HeyGen", description: "AI avatar video generation (UGC)", category: "Content Generation" },
  // Stock footage
  { value: "pexels", label: "Pexels", description: "Stock video footage for B-roll", category: "Content Generation" },
  // Domain registrars
  { value: "porkbun", label: "Porkbun", description: "Domain registrar — auto DNS & URL forwarding", category: "Domain Registrar" },
];

const PROVIDER_HELP: Record<string, {
  description: string;
  steps: { text: string; link?: { url: string; label: string } }[];
  importantNote?: {
    title: string;
    description: string;
    webhookUrl: string;
    actors: { platform: string; actor: string }[];
  };
}> = {
  openrouter: {
    description: "OpenRouter is a unified API gateway for accessing 100+ AI models from various providers.",
    steps: [
      { text: "Create an account at", link: { url: "https://openrouter.ai", label: "openrouter.ai" } },
      { text: "Go to", link: { url: "https://openrouter.ai/keys", label: "Keys" } },
      { text: "Click Create Key and copy it" },
      { text: "Add", link: { url: "https://openrouter.ai/credits", label: "credits" } },
    ],
  },
  ollama: {
    description: "Run open models via Ollama Cloud, or connect your own Ollama server. Note: a server on localhost is NOT reachable from the cloud — expose it via a public URL (Tailscale funnel, ngrok, VPS) or use Ollama Cloud.",
    steps: [
      { text: "Ollama Cloud: create an account at", link: { url: "https://ollama.com", label: "ollama.com" } },
      { text: "Generate an API key at", link: { url: "https://ollama.com/settings/keys", label: "Settings → Keys" } },
      { text: "Self-hosted: enter your server's public URL below instead (API key optional)" },
    ],
  },
  alibaba: {
    description: "Direct access to Alibaba Cloud's DashScope (Qwen models) — cheaper than routing the same models through OpenRouter's markup.",
    steps: [
      { text: "Create an account at", link: { url: "https://www.alibabacloud.com", label: "alibabacloud.com" } },
      { text: "Open Model Studio and generate an API key at", link: { url: "https://bailian.console.alibabacloud.com/?apiKey=1", label: "API Keys" } },
      { text: "Pick your region below — International or Mainland China — matching where the key was created" },
      { text: "If your workspace uses a dedicated/private deployment (its console shows a workspace-specific API host like ws-xxxxx.<region>.maas.aliyuncs.com), choose \"Custom\" and paste its \"OpenAI Compatible Endpoint\" URL instead — the shared regional endpoints won't accept that key" },
      { text: "Workspace ID is optional — only needed if your account uses DashScope workspace scoping" },
    ],
  },
  openai: {
    description: "Direct OpenAI API access. Required for the multiturn carousel image pipeline (GPT-5.5 via the Responses API) — each slide is threaded to the previous one, which keeps characters and style consistent across the deck. OpenRouter cannot do this because its pass-through doesn't preserve generated images between calls.",
    steps: [
      { text: "Create an account at", link: { url: "https://platform.openai.com", label: "platform.openai.com" } },
      { text: "Go to", link: { url: "https://platform.openai.com/api-keys", label: "API keys" } },
      { text: "Click Create new secret key and copy it" },
      { text: "Add", link: { url: "https://platform.openai.com/account/billing", label: "billing credit" }, },
    ],
  },
  replicate: {
    description: "Replicate is a platform for running AI image and video generation models.",
    steps: [
      { text: "Sign up with GitHub at", link: { url: "https://replicate.com", label: "replicate.com" } },
      { text: "Go to", link: { url: "https://replicate.com/account/api-tokens", label: "Account → API tokens" } },
      { text: "Create a token and copy it" },
      { text: "Add", link: { url: "https://replicate.com/account/billing", label: "billing" } },
    ],
  },
  elevenlabs: {
    description: "ElevenLabs provides high-quality AI voice generation and cloning.",
    steps: [
      { text: "Create an account at", link: { url: "https://elevenlabs.io", label: "elevenlabs.io" } },
      { text: "Go to", link: { url: "https://elevenlabs.io/app/settings/api-keys", label: "Settings → API Keys" } },
      { text: "Click Create API Key and copy it" },
    ],
  },
  apify: {
    description: "Apify is a web scraping and automation platform. Note: Apify API keys expire every 90 days and will need to be refreshed.",
    steps: [
      { text: "Create an account at", link: { url: "https://apify.com", label: "apify.com" } },
      { text: "Go to", link: { url: "https://console.apify.com/account/integrations", label: "Account → Integrations" } },
      { text: "Copy your Personal API Token" },
    ],
    importantNote: {
      title: "Configure Webhooks in Apify",
      description: "Add this webhook URL to each actor you use (Settings → Integrations → Webhooks):",
      webhookUrl: `${FUNCTIONS_URL}/apify-webhook`,
      actors: [
        { platform: "YouTube", actor: "streamers/youtube-scraper" },
        { platform: "TikTok", actor: "clockworks/tiktok-scraper" },
        { platform: "Instagram", actor: "apify/instagram-post-scraper" },
        { platform: "LinkedIn", actor: "supreme_coder/linkedin-post" },
      ],
    },
  },
  youtube: {
    description: "YouTube Data API allows access to YouTube content and metadata.",
    steps: [
      { text: "Go to", link: { url: "https://console.cloud.google.com/apis/credentials", label: "Google Cloud Console" } },
      { text: "Create a project (or select existing)" },
      { text: "Enable the YouTube Data API v3" },
      { text: "Create an API Key in Credentials" },
    ],
  },
  leadconnector: {
    description: "LeadConnector integration for social media publishing.",
    steps: [
      { text: "Go to", link: { url: "https://marketplace.leadconnector.com/", label: "LeadConnector Marketplace" } },
      { text: "Create or access your app" },
      { text: "Get your Private Integration Token" },
      { text: "Ensure socialplanner/account.readonly scope is enabled" },
    ],
  },
  unipile: {
    description: "Only needed if you bring your own Unipile account for WhatsApp, Telegram, Instagram and other channels. LinkedIn connects in Settings → Senders without a key.",
    steps: [
      { text: "Sign up at", link: { url: "https://unipile.com", label: "unipile.com" } },
      { text: "Go to your Dashboard" },
      { text: "Copy your API Key. That's all a v2 key needs" },
    ],
  },
  // Contact Enrichment Providers
  apollo: {
    description: "Apollo.io provides email and phone enrichment from LinkedIn profiles with unlimited basic searches.",
    steps: [
      { text: "Create an account at", link: { url: "https://www.apollo.io", label: "apollo.io" } },
      { text: "Go to", link: { url: "https://app.apollo.io/#/settings/integrations/api", label: "Settings → API" } },
      { text: "Generate an API Key and copy it" },
      { text: "Free tier: 50 credits/month. Paid plans start at $49/mo" },
    ],
  },
  hunter: {
    description: "Hunter finds professional email addresses from a person's name and company domain. ACA shares Hunter's 500 requests/minute capacity across every running list.",
    steps: [
      { text: "Create an account at", link: { url: "https://hunter.io", label: "hunter.io" } },
      { text: "Open", link: { url: "https://hunter.io/api-keys", label: "API keys" } },
      { text: "Create or copy an API key" },
    ],
  },
  prospeo: {
    description: "Prospeo provides email finding and verification from LinkedIn URLs.",
    steps: [
      { text: "Create an account at", link: { url: "https://prospeo.io", label: "prospeo.io" } },
      { text: "Go to API in your dashboard" },
      { text: "Copy your API key" },
      { text: "Free trial available. Paid plans start at $39/mo" },
    ],
  },
  moltsets: {
    description: "MoltSets resolves LinkedIn profiles to business emails.",
    steps: [
      { text: "Create an account at", link: { url: "https://tolt.link/aca", label: "moltsets.com" } },
      { text: "Go to your dashboard's API section" },
      { text: "Copy your API key" },
      { text: "Pick the plan that matches your subscription below" },
    ],
  },
  quickenrich: {
    description: "QuickEnrich finds emails, phones and company contacts via LinkedIn URL, company domain, name, or email reverse-lookup. One credit only when a result is returned.",
    steps: [
      { text: "Create an account at", link: { url: "https://app.quickenrich.io", label: "quickenrich.io" } },
      { text: "Contact QuickEnrich support to get your API key" },
      { text: "Copy your API key" },
      { text: "API docs:", link: { url: "https://app.quickenrich.io/docs", label: "app.quickenrich.io/docs" } },
      { text: "Pick Standard or GTM Unlimited below to match your subscription" },
    ],
  },
  zernio: {
    description: "Zernio publishes your Scheduler posts to Facebook, Instagram, TikTok, Google Business, YouTube, Threads, Pinterest, X and Bluesky. You connect your social accounts in Zernio; they then show up in the Scheduler.",
    steps: [
      { text: "Create an account at", link: { url: "https://zernio.com", label: "zernio.com" } },
      { text: "Connect your social accounts in Zernio" },
      { text: "Go to", link: { url: "https://zernio.com/dashboard/api-keys", label: "Dashboard → API keys" } },
      { text: "Create a key and copy it (it starts with sk_ and is shown once)" },
    ],
  },
  zapmail: {
    description: "ZapMail handles mailbox provisioning, domain management, and compliance for cold email infrastructure.",
    steps: [
      { text: "Log in at", link: { url: "https://app.zapmail.ai", label: "app.zapmail.ai" } },
      { text: "Go to Settings > API" },
      { text: "Copy your API key" },
    ],
  },
  mailtester_ninja: {
    description: "Mailtester Ninja offers affordable email deliverability checks. Plans: Starter $6.99/wk (50k/day), Pro $16.99/mo (100k/day), Ultimate $49.99/mo (500k/day). Pick the plan that matches your subscription so we can pace requests inside the rate cap.",
    steps: [
      { text: "Sign up at", link: { url: "https://mailtester.ninja/", label: "mailtester.ninja" } },
      { text: "Pick a plan that fits your daily volume" },
      { text: "Go to your dashboard and copy the API key" },
    ],
  },
  heygen: {
    description: "HeyGen creates AI avatar videos from text scripts with built-in voice synthesis. Perfect for UGC-style content at scale.",
    steps: [
      { text: "Create an account at", link: { url: "https://www.heygen.com/?sid=rewardful&via=cedric", label: "heygen.com" } },
      { text: "Go to", link: { url: "https://app.heygen.com/settings/api", label: "Settings → API" } },
      { text: "Copy your API key" },
      { text: "Webhook is auto-configured — no manual setup needed" },
    ],
  },
  pexels: {
    description: "Pexels provides free stock video footage used for B-roll cutaways in presenter videos.",
    steps: [
      { text: "Create a free account at", link: { url: "https://www.pexels.com/api/", label: "pexels.com/api" } },
      { text: "Go to your API Keys page" },
      { text: "Copy your API key" },
    ],
  },
  porkbun: {
    description: "Porkbun domain registrar. Allows automatic DNS record setup and URL forwarding for your email sending domains.",
    steps: [
      { text: "Log in at", link: { url: "https://porkbun.com", label: "porkbun.com" } },
      { text: "Go to Account → API Access" },
      { text: "Enable API access if not already enabled" },
      { text: "Copy your API Key and Secret API Key" },
    ],
  },
};

export function AddApiKeyDialog({ open, onOpenChange, defaultProvider }: AddApiKeyDialogProps) {
  const addApiKey = useAddApiKey();
  const [selectedProvider, setSelectedProvider] = useState<string>("");
  // Alibaba's dsnUrl field triples as: undefined (international default),
  // 'cn' (mainland default), or a literal base URL (dedicated/workspace
  // endpoint, e.g. a private Model Studio deployment). This tracks which of
  // the three the picker is showing, independent of the field's raw value.
  const [alibabaEndpointMode, setAlibabaEndpointMode] = useState<"intl" | "cn" | "custom">("intl");

  const form = useForm<ApiKeyFormData>({
    resolver: zodResolver(apiKeySchema),
    defaultValues: {
      apiKey: "",
      capability: "",
      dsnUrl: "",
      secondaryKey: "",
      plan: undefined,
      requestsPerMinute: undefined,
    },
  });

  // Pre-select provider when dialog opens with a defaultProvider
  useEffect(() => {
    if (open && defaultProvider) {
      form.setValue("provider", defaultProvider as ApiKeyFormData["provider"]);
      setSelectedProvider(defaultProvider);
    }
  }, [open, defaultProvider, form]);

  const onSubmit = async (data: ApiKeyFormData) => {
    await addApiKey.mutateAsync({
      provider: data.provider,
      apiKey: data.apiKey,
      capability: data.capability,
      dsnUrl: data.dsnUrl,
      secondaryKey: data.secondaryKey,
      plan: data.plan,
      requestsPerMinute: data.requestsPerMinute,
    });
    form.reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add API Key</DialogTitle>
          <DialogDescription>
            Add a new API key for external services
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="provider"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Provider</FormLabel>
                  <Select
                    onValueChange={(value) => {
                      field.onChange(value);
                      setSelectedProvider(value);
                      form.setValue("plan", undefined);
                      form.setValue("requestsPerMinute", undefined);
                      setAlibabaEndpointMode("intl");
                    }}
                    value={field.value}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a provider" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent className="max-h-[300px]">
                      {/* Group providers by category */}
                      {["Content Generation", "Data & Scraping", "CRM & Social", "Contact Enrichment", "Email Infrastructure", "Email Verification", "Domain Registrar"].map((category) => {
                        const categoryProviders = PROVIDERS.filter((p) => p.category === category);
                        if (categoryProviders.length === 0) return null;
                        return (
                          <SelectGroup key={category}>
                            <SelectLabel className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                              {category}
                            </SelectLabel>
                            {categoryProviders.map((provider) => (
                              <SelectItem key={provider.value} value={provider.value} textValue={provider.label}>
                                <div>
                                  <div className="font-medium">{provider.label}</div>
                                  <div className="text-xs text-muted-foreground">
                                    {provider.description}
                                  </div>
                                </div>
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {selectedProvider && PROVIDER_HELP[selectedProvider] && (
              <div className="space-y-3">
                <div className="p-3 rounded-lg bg-muted/50 space-y-2">
                  <p className="text-sm text-muted-foreground">
                    {PROVIDER_HELP[selectedProvider].description}
                  </p>
                  <ol className="text-xs text-muted-foreground list-decimal list-inside space-y-1">
                    {PROVIDER_HELP[selectedProvider].steps.map((step, index) => (
                      <li key={index}>
                        {step.link ? (
                          <>
                            {step.text}{" "}
                            <a
                              href={step.link.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary hover:underline font-medium"
                            >
                              {step.link.label}
                            </a>
                          </>
                        ) : (
                          step.text
                        )}
                      </li>
                    ))}
                  </ol>
                </div>

                {/* Important note for Apify webhook configuration */}
                {PROVIDER_HELP[selectedProvider].importantNote && (
                  <div className="p-3 rounded-lg bg-status-warning/10 border border-status-warning/30 space-y-2">
                    <p className="text-sm font-medium text-status-warning">
                      {PROVIDER_HELP[selectedProvider].importantNote.title}
                    </p>
                    <p className="text-xs text-status-warning/80">
                      {PROVIDER_HELP[selectedProvider].importantNote.description}
                    </p>
                    <code className="text-xs bg-status-warning/20 px-2 py-1 rounded block break-all text-status-warning">
                      {PROVIDER_HELP[selectedProvider].importantNote.webhookUrl}
                    </code>
                    <div className="mt-2">
                      <p className="text-xs font-medium text-status-warning mb-1">
                        Required actors:
                      </p>
                      <ul className="text-xs text-status-warning/80 space-y-0.5">
                        {PROVIDER_HELP[selectedProvider].importantNote.actors.map((actor, idx) => (
                          <li key={idx}>
                            <span className="font-medium">{actor.platform}:</span>{" "}
                            <a
                              href={`https://apify.com/${actor.actor}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-status-warning hover:underline"
                            >
                              {actor.actor}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
              </div>
            )}

            <FormField
              control={form.control}
              name="apiKey"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {selectedProvider === "ollama" ? "API Key (required for Ollama Cloud)" : "API Key"}
                  </FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      placeholder={selectedProvider === "ollama" ? "Leave empty for a self-hosted server without auth" : "Enter your API key"}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    Your key will be encrypted and stored securely
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {selectedProvider === "ollama" && (
              <FormField
                control={form.control}
                name="dsnUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Server URL (leave empty for Ollama Cloud)</FormLabel>
                    <FormControl>
                      <Input
                        type="text"
                        placeholder="https://ollama.your-domain.com"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      Must be publicly reachable — localhost won't work from the cloud
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {selectedProvider === "alibaba" && (
              <>
                <FormField
                  control={form.control}
                  name="dsnUrl"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Region</FormLabel>
                      <Select
                        onValueChange={(mode: "intl" | "cn" | "custom") => {
                          setAlibabaEndpointMode(mode);
                          // 'intl'/'cn' are shorthand defaults resolved server-side;
                          // 'custom' clears the field so the URL input below takes over.
                          field.onChange(mode === "custom" ? "" : mode === "cn" ? "cn" : "");
                        }}
                        value={alibabaEndpointMode}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select the DashScope region" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="intl">International (dashscope-intl.aliyuncs.com)</SelectItem>
                          <SelectItem value="cn">Mainland China (dashscope.aliyuncs.com)</SelectItem>
                          <SelectItem value="custom">Custom / dedicated endpoint</SelectItem>
                        </SelectContent>
                      </Select>
                      {alibabaEndpointMode === "custom" ? (
                        <>
                          <Input
                            type="text"
                            placeholder="https://ws-xxxxx.cn-beijing.maas.aliyuncs.com/compatible-mode/v1"
                            value={field.value ?? ""}
                            onChange={field.onChange}
                            className="mt-2"
                          />
                          <FormDescription>
                            Paste the "OpenAI Compatible Endpoint" URL from your Model Studio
                            workspace — not the bare API host or the native DashScope (/api/v1) URL.
                          </FormDescription>
                        </>
                      ) : (
                        <FormDescription>
                          Must match the console region the key was created in — pick "Custom" if
                          your workspace uses a dedicated endpoint (e.g. a private deployment host)
                        </FormDescription>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="secondaryKey"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Workspace ID (optional)</FormLabel>
                      <FormControl>
                        <Input
                          type="text"
                          placeholder="Leave empty unless your account uses workspace scoping"
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>
                        Sent as the X-DashScope-WorkSpace header
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            )}

            {selectedProvider === "mailtester_ninja" && (
              <FormField
                control={form.control}
                name="plan"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Plan</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value ?? ""}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select your Mailtester Ninja plan" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="starter">Starter — 50k/day ($6.99/wk)</SelectItem>
                        <SelectItem value="pro">Pro — 100k/day, 11 / 10s ($16.99/mo)</SelectItem>
                        <SelectItem value="ultimate">Ultimate — 500k/day, 57 / 10s ($49.99/mo)</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      We pace requests to stay inside this plan's rate cap and stop the day's batch when the cap is reached.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {selectedProvider === "moltsets" && (
              <FormField
                control={form.control}
                name="plan"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Plan</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value ?? ""}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select your MoltSets plan" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="tier_27">$27/mo — 30 req/min, 1,000/day</SelectItem>
                        <SelectItem value="tier_97">$97/mo — 1,000 req/min, 15,000/day</SelectItem>
                        <SelectItem value="tier_997">$997/mo — 5,000 req/min, 100,000/day</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      We pace requests to stay inside this plan's rate cap and stop each day once the daily cap is reached.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {selectedProvider === "quickenrich" && (
              <FormField
                control={form.control}
                name="plan"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Plan</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value ?? ""}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select your QuickEnrich plan" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="standard">Standard — 1000 req/min (search/phone/email), 300 domain, 120 finder</SelectItem>
                        <SelectItem value="gtm_unlimited">GTM Unlimited — 6000 req/min on all endpoints</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      We pace requests to stay inside this plan's per-endpoint rate limits.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {selectedProvider === "prospeo" && (
              <FormField
                control={form.control}
                name="plan"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Plan</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value ?? ""}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select your Prospeo plan" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="starter">Starter - 300 req/min, 2,000/day</SelectItem>
                        <SelectItem value="growth">Growth - 300 req/min, 5,000/day</SelectItem>
                        <SelectItem value="pro">Pro - 1,800 req/min, 500,000/day</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      The workflow shares this capacity across every list using the key.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {selectedProvider === "apollo" && (
              <FormField
                control={form.control}
                name="requestsPerMinute"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>People enrichment requests per minute</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={1}
                        max={100000}
                        placeholder="Shown in Apollo API Usage"
                        {...field}
                        value={field.value ?? ""}
                      />
                    </FormControl>
                    <FormDescription>
                      Apollo sets this per account. Enter the People Enrichment minute limit shown in Apollo&apos;s API Usage page.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}


            {selectedProvider === "replicate" && (
              <FormField
                control={form.control}
                name="capability"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Capability (Optional)</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select capability" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="video">Video Generation</SelectItem>
                        <SelectItem value="image">Image Generation</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      Specify what this key will be used for
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {selectedProvider === "porkbun" && (
              <FormField
                control={form.control}
                name="secondaryKey"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Secret API Key</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder="Enter your Porkbun secret API key"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      Your Porkbun secret API key (encrypted and stored securely)
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <div className="flex justify-end gap-3 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button variant="cta" type="submit" disabled={addApiKey.isPending}>
                {addApiKey.isPending ? "Adding..." : "Add API Key"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
