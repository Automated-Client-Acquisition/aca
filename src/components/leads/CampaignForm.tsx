import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Linkedin,
  Instagram,
  Info,
  Bot,
  Target,
  Zap,
  BookOpen,
  FileText,
  Loader2,
  Search,
  MessageSquare,
  Mail,
  Globe,
  Settings2,
  Users,
  ArrowRight,
  AlertCircle,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ExpandableTextarea } from "@/components/ui/expandable-textarea";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAgentProfiles } from "@/hooks/useAgentProfiles";
import { cn } from "@/lib/utils";
import { useICPs } from "@/hooks/useICPs";
import { useBrandVoices } from "@/hooks/useBrandVoices";
import { useCompletedKnowledgeDocuments } from "@/hooks/useKnowledgeBase";
import { LlmModelSelect } from "@/components/shared/LlmModelSelect";
import { AgentProfileSelector } from "@/components/autopilot/AgentProfileSelector";
import { CreateAgentDialog } from "@/components/autopilot/CreateAgentDialog";
import type { UnipileAccount } from "@/hooks/useUnipileAccounts";
import type {
  UnipileCampaign,
  CreateCampaignInput,
} from "@/hooks/useUnipileCampaigns";

type EditorSection = "campaign" | "delivery" | "audience" | "ai" | "limits";

interface CampaignFormProps {
  accounts: UnipileAccount[];
  initialData?: UnipileCampaign;
  onSubmit: (data: CreateCampaignInput) => void;
  onCancel: () => void;
  isLoading: boolean;
  submitError?: string | null;
}

export function CampaignForm({
  accounts,
  initialData,
  onSubmit,
  onCancel,
  isLoading,
  submitError,
}: CampaignFormProps) {
  const isMobile = useIsMobile();
  const [activeSection, setActiveSection] = useState<EditorSection>("campaign");
  const [validationAttempted, setValidationAttempted] = useState(false);
  const [openAudienceSections, setOpenAudienceSections] = useState<string[]>([
    ...(initialData?.auto_add_posts ? ["posts"] : []),
    ...(initialData?.icp_id ? ["qualification"] : []),
  ]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const instructionTouchedRef = useRef(false);
  const profileInitializedRef = useRef(false);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [activeSection]);
  const [senderAccountIds, setSenderAccountIds] = useState<string[]>(
    initialData?.sender_account_ids?.length
      ? initialData.sender_account_ids
      : initialData?.account_id
        ? [initialData.account_id]
        : [],
  );
  const [name, setName] = useState(initialData?.name || "");
  const [triggerKeywords, setTriggerKeywords] = useState(
    initialData?.trigger_keywords || "",
  );
  const [dmTemplate, setDmTemplate] = useState(
    initialData?.dm_template ||
      "Hey {name}! Thanks for your interest. Here's the link to download: [YOUR_LINK_HERE]",
  );
  const [dmDelaySeconds, setDmDelaySeconds] = useState(
    initialData?.dm_delay_seconds || 30,
  );
  const [maxDmsPerHour, setMaxDmsPerHour] = useState(
    initialData?.max_dms_per_hour || 10,
  );
  const [maxDmsPerDay, setMaxDmsPerDay] = useState(
    initialData?.max_dms_per_day || 50,
  );
  const [userCooldownHours, setUserCooldownHours] = useState(
    initialData?.user_cooldown_hours || 24,
  );
  const [webhookUrl, setWebhookUrl] = useState(initialData?.webhook_url || "");
  const [autoAcceptConnections, setAutoAcceptConnections] = useState(
    initialData?.auto_accept_connections ?? true,
  );
  const [requireConnectionForLinkedin, setRequireConnectionForLinkedin] =
    useState(initialData?.require_connection_for_linkedin ?? true);
  const [commentLinkMode, setCommentLinkMode] = useState<"gated" | "direct">(
    initialData?.comment_link_mode || "gated",
  );

  // ICP scoring state
  const [icpId, setIcpId] = useState(initialData?.icp_id || "");
  const [icpThreshold, setIcpThreshold] = useState(
    initialData?.icp_threshold ?? 50,
  );

  // Auto-add posts state
  const [autoAddPosts, setAutoAddPosts] = useState(
    initialData?.auto_add_posts ?? false,
  );
  const [autoAddPostsAccountIds, setAutoAddPostsAccountIds] = useState<
    string[]
  >(initialData?.auto_add_posts_account_ids || []);

  // AI chatbot state
  const [aiChatbotEnabled, setAiChatbotEnabled] = useState(
    initialData?.ai_chatbot_enabled ?? false,
  );
  const [aiChatbotInstructions, setAiChatbotInstructions] = useState(
    initialData?.ai_chatbot_instructions || "",
  );
  const [aiChatbotBrandVoiceId, setAiChatbotBrandVoiceId] = useState(
    initialData?.ai_chatbot_brand_voice_id || "",
  );
  const [aiChatbotModel, setAiChatbotModel] = useState(
    initialData?.ai_chatbot_model || "anthropic/claude-sonnet-4.5",
  );
  const [aiChatbotMaxTurns, setAiChatbotMaxTurns] = useState(
    initialData?.ai_chatbot_max_turns ?? 10,
  );

  // Agent profile state
  const [agentProfileId, setAgentProfileId] = useState<string | null>(
    initialData?.agent_profile_id || null,
  );
  const [createAgentOpen, setCreateAgentOpen] = useState(false);

  // Knowledge base documents state
  const [knowledgeDocumentIds, setKnowledgeDocumentIds] = useState<string[]>(
    initialData?.knowledge_document_ids || [],
  );
  const [knowledgeDocumentSearchQuery, setKnowledgeDocumentSearchQuery] =
    useState("");

  const { data: agentProfiles } = useAgentProfiles();
  const { icps } = useICPs();
  const { brandVoices } = useBrandVoices();
  const { data: knowledgeDocuments } = useCompletedKnowledgeDocuments();

  useEffect(() => {
    if (profileInitializedRef.current || !agentProfiles) return;
    profileInitializedRef.current = true;
    if (
      !instructionTouchedRef.current &&
      initialData?.agent_profile_id &&
      !initialData.ai_chatbot_instructions &&
      agentProfileId === initialData.agent_profile_id
    ) {
      const instructions = agentProfiles.find(
        (profile) => profile.id === agentProfileId,
      )?.config.system_instructions;
      if (instructions) setAiChatbotInstructions(instructions);
    }
  }, [agentProfiles, initialData, agentProfileId]);

  const activeAccounts = accounts.filter(
    (a) =>
      a.status === "active" &&
      (a.provider === "LINKEDIN" || a.provider === "INSTAGRAM"),
  );
  const availableAccountIds = new Set(
    activeAccounts.map((account) => account.id),
  );
  const validSenderAccountIds = senderAccountIds.filter((id) =>
    availableAccountIds.has(id),
  );
  const validAutoAddPostsAccountIds = autoAddPostsAccountIds.filter((id) =>
    availableAccountIds.has(id),
  );
  const hasUnavailableSenders =
    validSenderAccountIds.length !== senderAccountIds.length;
  const hasUnavailablePostSources =
    validAutoAddPostsAccountIds.length !== autoAddPostsAccountIds.length;
  const hasMissingPostSource =
    autoAddPosts && validAutoAddPostsAccountIds.length === 0;
  const isLinkedInAccount = validSenderAccountIds.some((id) => {
    const acc = activeAccounts.find((a) => a.id === id);
    return acc?.provider === "LINKEDIN";
  });
  const filteredKnowledgeDocuments = useMemo(() => {
    const docs = knowledgeDocuments || [];
    const query = knowledgeDocumentSearchQuery.trim().toLowerCase();
    if (!query) return docs;
    return docs.filter(
      (doc) =>
        doc.name.toLowerCase().includes(query) ||
        (doc.description || "").toLowerCase().includes(query),
    );
  }, [knowledgeDocuments, knowledgeDocumentSearchQuery]);

  const sections = [
    {
      id: "campaign",
      label: "Campaign",
      description: "Name & senders",
      icon: Users,
      title: "Campaign details",
      help: "Choose the name and accounts that send your resource.",
    },
    {
      id: "delivery",
      label: "Delivery",
      description: "Keywords & message",
      icon: MessageSquare,
      title: "Resource delivery",
      help: "Set the comment keywords and the message people receive.",
    },
    {
      id: "audience",
      label: "Audience",
      description: "Posts & qualification",
      icon: Target,
      title: "Posts & lead qualification",
      help: "Choose which posts to monitor and who receives your resource.",
    },
    {
      id: "ai",
      label: "AI assistant",
      description: aiChatbotEnabled ? "Enabled" : "Off",
      icon: Bot,
      title: "AI follow-up",
      help: "Choose how to continue the conversation after resource delivery.",
    },
    {
      id: "limits",
      label: "Limits",
      description: "Timing & webhook",
      icon: Settings2,
      title: "Sending limits & integrations",
      help: "Control message frequency and connect lead notifications.",
    },
  ] as const;
  type ValidationIssue = {
    section: EditorSection;
    field: string;
    message: string;
  };
  const validationIssues: ValidationIssue[] = [];
  if (!name.trim())
    validationIssues.push({
      section: "campaign",
      field: "name",
      message: "Enter a campaign name.",
    });
  if (!validSenderAccountIds.length)
    validationIssues.push({
      section: "campaign",
      field: "sender-accounts",
      message: "Select an active sending account.",
    });
  if (!triggerKeywords.split(",").some((keyword) => keyword.trim()))
    validationIssues.push({
      section: "delivery",
      field: "keywords",
      message: "Add at least one comment keyword.",
    });
  if (!dmTemplate.trim())
    validationIssues.push({
      section: "delivery",
      field: "template",
      message: "Write a resource delivery message.",
    });
  if (hasMissingPostSource)
    validationIssues.push({
      section: "audience",
      field: "auto-add-posts",
      message: "Select a post source or turn off automatic monitoring.",
    });
  if (aiChatbotEnabled && !aiChatbotInstructions.trim())
    validationIssues.push({
      section: "ai",
      field: "ai-instructions",
      message:
        "Add chatbot instructions or load an agent profile with instructions.",
    });
  const numberFields = [
    {
      field: "delay",
      value: dmDelaySeconds,
      min: 10,
      max: 300,
      label: "DM delay",
      section: "limits",
    },
    {
      field: "cooldown",
      value: userCooldownHours,
      min: 1,
      max: 168,
      label: "Contact cooldown",
      section: "limits",
    },
    {
      field: "hourly",
      value: maxDmsPerHour,
      min: 1,
      max: 50,
      label: "Hourly DM limit",
      section: "limits",
    },
    {
      field: "daily",
      value: maxDmsPerDay,
      min: 1,
      max: 200,
      label: "Daily DM limit",
      section: "limits",
    },
    ...(aiChatbotEnabled
      ? [
          {
            field: "max-turns",
            value: aiChatbotMaxTurns,
            min: 1,
            max: 50,
            label: "Conversation turns",
            section: "ai",
          },
        ]
      : []),
  ];
  for (const field of numberFields)
    if (
      !Number.isInteger(field.value) ||
      field.value < field.min ||
      field.value > field.max
    )
      validationIssues.push({
        section: field.section as EditorSection,
        field: field.field,
        message: `${field.label} must be between ${field.min} and ${field.max}.`,
      });
  if (webhookUrl.trim()) {
    try {
      new URL(webhookUrl);
    } catch {
      validationIssues.push({
        section: "limits",
        field: "webhook",
        message: "Enter a complete webhook URL, including https://.",
      });
    }
  }
  const showIssue = (issue: ValidationIssue) => {
    setActiveSection(issue.section);
    if (issue.section === "audience")
      setOpenAudienceSections((previous) =>
        Array.from(new Set([...previous, "posts"])),
      );
    requestAnimationFrame(() => document.getElementById(issue.field)?.focus());
  };
  const isFieldInvalid = (field: string) =>
    validationAttempted &&
    validationIssues.some((issue) => issue.field === field);
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;
    setValidationAttempted(true);
    if (validationIssues.length) {
      showIssue(validationIssues[0]);
      return;
    }

    onSubmit({
      account_id: validSenderAccountIds[0],
      sender_account_ids: validSenderAccountIds,
      name,
      trigger_keywords: triggerKeywords,
      dm_template: dmTemplate,
      dm_delay_seconds: dmDelaySeconds,
      max_dms_per_hour: maxDmsPerHour,
      max_dms_per_day: maxDmsPerDay,
      user_cooldown_hours: userCooldownHours,
      webhook_url: webhookUrl || null,
      auto_accept_connections: autoAcceptConnections,
      require_connection_for_linkedin: requireConnectionForLinkedin,
      comment_link_mode: requireConnectionForLinkedin
        ? "gated"
        : commentLinkMode,
      // ICP scoring
      icp_id: icpId || null,
      icp_threshold: icpId ? icpThreshold : 0,
      // AI chatbot
      ai_chatbot_enabled: aiChatbotEnabled,
      ai_chatbot_instructions: aiChatbotEnabled ? aiChatbotInstructions : null,
      ai_chatbot_brand_voice_id:
        aiChatbotEnabled && aiChatbotBrandVoiceId
          ? aiChatbotBrandVoiceId
          : null,
      ai_chatbot_model: aiChatbotEnabled ? aiChatbotModel : null,
      ai_chatbot_max_turns: aiChatbotMaxTurns,
      // Auto-add posts
      auto_add_posts: autoAddPosts,
      auto_add_posts_account_ids: autoAddPosts
        ? validAutoAddPostsAccountIds
        : [],
      // Knowledge base documents
      knowledge_document_ids: aiChatbotEnabled ? knowledgeDocumentIds : [],
      // Agent profile
      agent_profile_id: aiChatbotEnabled ? agentProfileId : null,
    });
  };

  return (
    <form
      noValidate
      onSubmit={handleSubmit}
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      <Tabs
        value={activeSection}
        onValueChange={(value) => setActiveSection(value as EditorSection)}
        orientation={isMobile ? "horizontal" : "vertical"}
        className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row"
      >
        <div className="shrink-0 border-b bg-muted/25 md:w-48 md:border-b-0 md:border-r">
          <TabsList
            aria-label="Campaign settings sections"
            className="flex h-auto w-full justify-start gap-1 overflow-x-auto rounded-none bg-transparent p-2 md:flex-col md:items-stretch md:p-3"
          >
            {sections.map((section) => (
              <TabsTrigger
                key={section.id}
                value={section.id}
                className="shrink-0 justify-start gap-2 rounded-lg px-3 py-3 text-left data-[state=active]:bg-background data-[state=active]:shadow-sm md:w-full md:items-start"
              >
                <section.icon className="mt-0.5 hidden h-4 w-4 shrink-0 sm:block" />
                <span>
                  <span className="block text-sm">{section.label}</span>
                  <span className="mt-1 hidden text-xs font-normal text-muted-foreground md:block">
                    {section.description}
                  </span>
                </span>
                {validationAttempted &&
                  validationIssues.some(
                    (issue) => issue.section === section.id,
                  ) && (
                    <AlertCircle
                      className="ml-auto h-3.5 w-3.5 shrink-0 text-destructive"
                      aria-label="Needs attention"
                    />
                  )}
              </TabsTrigger>
            ))}
          </TabsList>
          <p className="hidden px-6 py-4 text-xs leading-relaxed text-muted-foreground md:block">
            Changes apply when you save.
          </p>
        </div>
        <div
          ref={scrollRef}
          className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6"
        >
          {sections.map((section) => (
            <TabsContent
              forceMount
              hidden={activeSection !== section.id}
              key={section.id}
              value={section.id}
              className="m-0 space-y-5"
            >
              <div className="space-y-1">
                <h3 className="text-lg font-semibold">{section.title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {section.help}
                </p>
              </div>
              {validationAttempted &&
                validationIssues.some(
                  (issue) => issue.section === section.id,
                ) && (
                  <div
                    role="alert"
                    className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                  >
                    {validationIssues
                      .filter((issue) => issue.section === section.id)
                      .map((issue) => (
                        <p key={issue.field}>{issue.message}</p>
                      ))}
                  </div>
                )}
              {section.id === "campaign" && (
                <div className="space-y-5">
                  {/* Campaign Name */}
                  <div className="space-y-2">
                    <Label htmlFor="name">Lead magnet name</Label>
                    <Input
                      id="name"
                      aria-invalid={isFieldInvalid("name")}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g., LinkedIn Growth Guide"
                      required
                    />
                  </div>
                  {/* Account Selection — Multi-select */}
                  <div
                    id="sender-accounts"
                    tabIndex={-1}
                    className="space-y-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Label>
                      Sending accounts{" "}
                      <span className="text-muted-foreground">· Required</span>
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Select one or more accounts that will send DMs. Each
                      account sends DMs for comments on its own posts.
                    </p>
                    {hasUnavailableSenders && (
                      <p
                        role="status"
                        className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300"
                      >
                        Some saved sending accounts are no longer available and
                        will be removed when you save.
                        {validSenderAccountIds.length === 0 &&
                          " Select an active LinkedIn or Instagram account to continue."}
                      </p>
                    )}
                    {activeAccounts.length > 0 ? (
                      <div className="grid max-h-48 gap-2 overflow-y-auto sm:grid-cols-2">
                        {activeAccounts.map((account) => {
                          const Icon =
                            account.provider === "LINKEDIN"
                              ? Linkedin
                              : Instagram;
                          const iconColor =
                            account.provider === "LINKEDIN"
                              ? "text-[#0A66C2]"
                              : "text-[#E1306C]";
                          const isChecked = senderAccountIds.includes(
                            account.id,
                          );
                          return (
                            <label
                              key={account.id}
                              className={cn(
                                "flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors hover:bg-muted/50",
                                isChecked &&
                                  "border-amber-500/60 bg-amber-500/5",
                              )}
                            >
                              <Checkbox
                                checked={isChecked}
                                onCheckedChange={(checked) => {
                                  if (checked) {
                                    setSenderAccountIds((prev) => [
                                      ...prev,
                                      account.id,
                                    ]);
                                  } else {
                                    setSenderAccountIds((prev) =>
                                      prev.filter((id) => id !== account.id),
                                    );
                                  }
                                }}
                              />
                              <Avatar className="h-9 w-9 shrink-0">
                                <AvatarImage
                                  src={account.avatar_url || undefined}
                                  referrerPolicy="no-referrer"
                                />
                                <AvatarFallback className="text-[9px] bg-muted">
                                  <Icon className={cn("h-3 w-3", iconColor)} />
                                </AvatarFallback>
                              </Avatar>
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium">
                                  {account.display_name ||
                                    account.username ||
                                    account.provider}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {account.provider === "LINKEDIN"
                                    ? "LinkedIn"
                                    : "Instagram"}
                                </p>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="rounded-xl border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
                        <p>
                          Connect a LinkedIn or Instagram account to send your
                          resource.
                        </p>
                        <Button
                          asChild
                          type="button"
                          variant="outline"
                          size="sm"
                          className="mt-3"
                        >
                          <Link to="/settings?tab=senders">
                            Connect an account
                          </Link>
                        </Button>
                      </div>
                    )}
                    {activeAccounts.length > 0 &&
                      validSenderAccountIds.length === 0 && (
                        <p className="text-xs text-amber-600 dark:text-amber-400">
                          Select at least one connected account.
                        </p>
                      )}
                  </div>
                </div>
              )}
              {section.id === "delivery" && (
                <div className="space-y-5">
                  {/* Trigger Keywords */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Label htmlFor="keywords">Comment keywords</Label>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              aria-label="About comment keywords"
                              className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              <Info className="h-4 w-4" aria-hidden="true" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs">
                            <p>
                              Comma-separated keywords. When someone comments
                              with any of these words, they'll receive your DM.
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                    <Input
                      id="keywords"
                      aria-invalid={isFieldInvalid("keywords")}
                      value={triggerKeywords}
                      onChange={(e) => setTriggerKeywords(e.target.value)}
                      placeholder="e.g., free, guide, download, interested"
                      required
                    />
                    <p className="text-xs text-muted-foreground">
                      Separate multiple keywords with commas. Case-insensitive
                      matching.
                    </p>
                  </div>
                  {/* DM Template — always shown (first message is always the template) */}
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <MessageSquare className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                      <Label
                        htmlFor="template"
                        className="text-base font-medium"
                      >
                        Resource delivery message
                      </Label>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {aiChatbotEnabled
                        ? "This message is sent first when someone comments with your keyword. The AI agent takes over the conversation after the lead replies."
                        : "This message is sent once when someone comments with your keyword. Enable AI follow-up in the AI assistant section for ongoing conversations."}
                    </p>
                    <ExpandableTextarea
                      id="template"
                      aria-invalid={isFieldInvalid("template")}
                      expandTitle="Edit DM Template"
                      value={dmTemplate}
                      onChange={(e) => setDmTemplate(e.target.value)}
                      placeholder="Hey {name}! Thanks for your interest. Here's the link to download: [YOUR_LINK_HERE]"
                      rows={6}
                      required
                    />
                    <p className="text-xs text-muted-foreground">
                      Personalize with:{" "}
                      <code className="text-[11px] bg-muted px-1 rounded">
                        {"{name}"}
                      </code>{" "}
                      <code className="text-[11px] bg-muted px-1 rounded">
                        {"{full_name}"}
                      </code>{" "}
                      <code className="text-[11px] bg-muted px-1 rounded">
                        {"{keyword}"}
                      </code>
                    </p>
                  </div>
                  {/* LinkedIn Delivery Mode */}
                  {isLinkedInAccount && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-4 rounded-lg border bg-background p-3">
                        <div className="space-y-0.5">
                          <Label htmlFor="require-connection">
                            Require Connection to DM
                          </Label>
                          <p className="text-xs text-muted-foreground">
                            {requireConnectionForLinkedin
                              ? "Leads must DM you a keyword before receiving the resource"
                              : "Resource link is shared directly in the comment reply"}
                          </p>
                        </div>
                        <Switch
                          id="require-connection"
                          checked={requireConnectionForLinkedin}
                          onCheckedChange={setRequireConnectionForLinkedin}
                        />
                      </div>

                      {/* Link mode selector — only when direct delivery is enabled */}
                      {!requireConnectionForLinkedin && (
                        <div className="rounded-lg border p-3 space-y-3 ml-1 border-l-2 border-l-amber-500/50">
                          <Label className="text-sm font-medium">
                            Comment Link Type
                          </Label>
                          <RadioGroup
                            value={commentLinkMode}
                            onValueChange={(v) =>
                              setCommentLinkMode(v as "gated" | "direct")
                            }
                            className="grid gap-2"
                          >
                            <label
                              htmlFor="link-gated"
                              className={cn(
                                "flex items-start gap-3 rounded-md border p-3 cursor-pointer transition-colors",
                                commentLinkMode === "gated"
                                  ? "border-amber-500/50 bg-amber-500/5"
                                  : "hover:bg-muted/50",
                              )}
                            >
                              <RadioGroupItem
                                value="gated"
                                id="link-gated"
                                className="mt-0.5"
                              />
                              <div className="space-y-1">
                                <div className="flex items-center gap-1.5">
                                  <Mail className="h-3.5 w-3.5 text-amber-500" />
                                  <span className="text-sm font-medium">
                                    Gated (email capture)
                                  </span>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                  Leads enter their email on a landing page to
                                  access the resource. You capture their email
                                  for follow-up.
                                </p>
                              </div>
                            </label>
                            <label
                              htmlFor="link-direct"
                              className={cn(
                                "flex items-start gap-3 rounded-md border p-3 cursor-pointer transition-colors",
                                commentLinkMode === "direct"
                                  ? "border-amber-500/50 bg-amber-500/5"
                                  : "hover:bg-muted/50",
                              )}
                            >
                              <RadioGroupItem
                                value="direct"
                                id="link-direct"
                                className="mt-0.5"
                              />
                              <div className="space-y-1">
                                <div className="flex items-center gap-1.5">
                                  <Globe className="h-3.5 w-3.5 text-blue-500" />
                                  <span className="text-sm font-medium">
                                    Direct link
                                  </span>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                  Posts your lead magnet URL directly in the
                                  comment. No gating, instant access.
                                </p>
                              </div>
                            </label>
                          </RadioGroup>
                        </div>
                      )}

                      {/* Auto-Accept Connections */}
                      <div className="flex items-center justify-between gap-4 rounded-lg border bg-background p-3">
                        <div className="space-y-0.5">
                          <Label htmlFor="auto-accept">
                            Auto-Accept Connection Requests
                          </Label>
                          <p className="text-xs text-muted-foreground">
                            Automatically accept connection requests from leads
                            and send the DM
                          </p>
                        </div>
                        <Switch
                          id="auto-accept"
                          checked={autoAcceptConnections}
                          onCheckedChange={setAutoAcceptConnections}
                        />
                      </div>
                    </div>
                  )}
                  {/* Instagram — just auto-accept (always DMs directly) */}
                  {!isLinkedInAccount && validSenderAccountIds.length > 0 && (
                    <div className="flex items-center justify-between gap-4 rounded-lg border bg-background p-3">
                      <div className="space-y-0.5">
                        <Label htmlFor="auto-accept">
                          Auto-Accept Connection Requests
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          Automatically accept connection requests from leads
                          and send the DM
                        </p>
                      </div>
                      <Switch
                        id="auto-accept"
                        checked={autoAcceptConnections}
                        onCheckedChange={setAutoAcceptConnections}
                      />
                    </div>
                  )}
                </div>
              )}
              {section.id === "audience" && (
                <Accordion
                  type="multiple"
                  value={openAudienceSections}
                  onValueChange={setOpenAudienceSections}
                  className="space-y-3"
                >
                  <AccordionItem
                    value="posts"
                    className="rounded-xl border bg-background"
                  >
                    <AccordionTrigger className="gap-3 px-4 text-left hover:no-underline">
                      <span className="flex items-center gap-3">
                        <Zap className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span>
                          <span className="flex items-center gap-2 text-sm font-medium">
                            Automatically monitor new posts{" "}
                            {autoAddPosts && (
                              <Badge
                                variant="secondary"
                                className="text-[10px]"
                              >
                                On
                              </Badge>
                            )}
                          </span>
                          <span className="block text-xs font-normal text-muted-foreground">
                            Discover new posts from selected accounts.
                          </span>
                        </span>
                      </span>
                    </AccordionTrigger>
                    {/* Auto-Add Posts Section */}
                    <AccordionContent className="space-y-4 px-4 pt-1">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Zap className="h-4 w-4 text-muted-foreground" />
                          <Label
                            htmlFor="auto-add-posts"
                            className="text-sm font-medium"
                          >
                            Enable automatic post monitoring
                          </Label>
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  aria-label="About automatic post monitoring"
                                  className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                >
                                  <Info
                                    className="h-4 w-4"
                                    aria-hidden="true"
                                  />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs">
                                <p>
                                  Automatically discover and monitor new posts
                                  from selected accounts. New posts are checked
                                  every 30 minutes.
                                </p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                        <Switch
                          id="auto-add-posts"
                          checked={autoAddPosts}
                          onCheckedChange={setAutoAddPosts}
                        />
                      </div>

                      {autoAddPosts && (
                        <div className="space-y-3 pt-2">
                          <Label>Monitor posts from these accounts</Label>
                          <div className="space-y-2">
                            {activeAccounts.map((account) => {
                              const Icon =
                                account.provider === "LINKEDIN"
                                  ? Linkedin
                                  : Instagram;
                              const iconColor =
                                account.provider === "LINKEDIN"
                                  ? "text-[#0A66C2]"
                                  : "text-[#E1306C]";
                              const isChecked = autoAddPostsAccountIds.includes(
                                account.id,
                              );
                              return (
                                <label
                                  key={account.id}
                                  className="flex items-center gap-3 p-2 rounded-md hover:bg-muted/50 cursor-pointer"
                                >
                                  <Checkbox
                                    checked={isChecked}
                                    onCheckedChange={(checked) => {
                                      if (checked) {
                                        setAutoAddPostsAccountIds((prev) => [
                                          ...prev,
                                          account.id,
                                        ]);
                                      } else {
                                        setAutoAddPostsAccountIds((prev) =>
                                          prev.filter(
                                            (id) => id !== account.id,
                                          ),
                                        );
                                      }
                                    }}
                                  />
                                  <Avatar className="h-5 w-5">
                                    <AvatarImage
                                      src={account.avatar_url || undefined}
                                      referrerPolicy="no-referrer"
                                    />
                                    <AvatarFallback className="text-[9px] bg-muted">
                                      <Icon
                                        className={cn("h-3 w-3", iconColor)}
                                      />
                                    </AvatarFallback>
                                  </Avatar>
                                  <span className="min-w-0 flex-1 truncate text-sm">
                                    {account.display_name ||
                                      account.username ||
                                      account.provider}
                                  </span>
                                </label>
                              );
                            })}
                            {activeAccounts.length === 0 && (
                              <p className="text-xs text-muted-foreground">
                                No active LinkedIn or Instagram accounts
                                available.
                              </p>
                            )}
                          </div>
                          {hasUnavailablePostSources && (
                            <p
                              role="status"
                              className="text-xs text-amber-700 dark:text-amber-300"
                            >
                              Unavailable saved post sources will be removed
                              when you save.
                            </p>
                          )}
                          {hasMissingPostSource && (
                            <p className="text-xs text-amber-700 dark:text-amber-300">
                              Select an active account to monitor, or turn off
                              automatic post monitoring to continue.
                            </p>
                          )}
                        </div>
                      )}
                    </AccordionContent>
                  </AccordionItem>
                  <AccordionItem
                    value="qualification"
                    className="rounded-xl border bg-background"
                  >
                    <AccordionTrigger className="gap-3 px-4 text-left hover:no-underline">
                      <span className="flex items-center gap-3">
                        <Target className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span>
                          <span className="flex items-center gap-2 text-sm font-medium">
                            Lead qualification{" "}
                            {icpId && (
                              <Badge
                                variant="secondary"
                                className="text-[10px]"
                              >
                                Filtered
                              </Badge>
                            )}
                          </span>
                          <span className="block text-xs font-normal text-muted-foreground">
                            Choose who receives your resource.
                          </span>
                        </span>
                      </span>
                    </AccordionTrigger>
                    {/* ICP Gate — pre-capture filter */}
                    <AccordionContent className="space-y-4 px-4 pt-1">
                      <div className="flex items-center gap-2">
                        <Target className="h-4 w-4 text-muted-foreground" />
                        <Label className="text-base font-medium">
                          Lead Quality Gate
                        </Label>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                aria-label="About lead qualification"
                                className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              >
                                <Info className="h-4 w-4" aria-hidden="true" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs">
                              <p>
                                Score commenters against your Ideal Customer
                                Profile <strong>before</strong> sending a DM.
                                Leads below the threshold are ignored entirely.
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Only send DMs to leads who match your ideal customer
                        profile. Leave empty to message everyone.
                      </p>

                      <div className="space-y-2">
                        <Label htmlFor="icp-select">ICP Profile</Label>
                        <Select
                          value={icpId || "__none__"}
                          onValueChange={(v) =>
                            setIcpId(v === "__none__" ? "" : v)
                          }
                        >
                          <SelectTrigger id="icp-select">
                            <SelectValue placeholder="None — DM all commenters" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">
                              None — DM all commenters
                            </SelectItem>
                            {icps.map((icp) => (
                              <SelectItem key={icp.id} value={icp.id}>
                                {icp.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {icps.length === 0 && (
                          <p className="text-xs text-muted-foreground">
                            No ICPs defined yet.{" "}
                            <Link
                              to="/assets?tab=icps"
                              className="text-primary hover:underline"
                            >
                              Create one in the Library
                            </Link>{" "}
                            to enable quality gating.
                          </p>
                        )}
                      </div>

                      {icpId && (
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <Label>Minimum Score to DM</Label>
                            <span className="text-sm font-mono font-medium text-primary">
                              {icpThreshold}/100
                            </span>
                          </div>
                          <Slider
                            aria-label="Minimum ICP score to receive a message"
                            value={[icpThreshold]}
                            onValueChange={([val]) => setIcpThreshold(val)}
                            min={0}
                            max={100}
                            step={5}
                          />
                          <p className="text-xs text-muted-foreground">
                            Commenters scoring below {icpThreshold} will be
                            skipped. Set to 0 to accept all and just show
                            scores.
                          </p>
                        </div>
                      )}
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              )}
              {section.id === "ai" && (
                <div className="space-y-5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Bot className="h-4 w-4 text-muted-foreground" />
                      <Label
                        htmlFor="ai-chatbot"
                        className="text-sm font-medium"
                      >
                        Enable AI follow-up
                      </Label>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              aria-label="About AI follow-up"
                              className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              <Info className="h-4 w-4" aria-hidden="true" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs">
                            <p>
                              After the first DM is sent, an AI agent will
                              handle multi-turn conversations using your
                              knowledge base. Without it, only the first DM is
                              sent.
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                    <Switch
                      id="ai-chatbot"
                      checked={aiChatbotEnabled}
                      onCheckedChange={setAiChatbotEnabled}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {aiChatbotEnabled
                      ? "After the first DM, the AI agent will nurture leads with multi-turn conversations. Manage response routing and reminder rules in the campaign’s Automation tab."
                      : "Only the first DM is sent when someone comments with your keyword. Enable the AI agent for multi-turn conversations after the first message."}
                  </p>
                  {aiChatbotEnabled && (
                    <div className="space-y-4 pt-2">
                      {/* Load from Agent Profile */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <Label className="text-sm">
                            Load from saved agent profile
                          </Label>
                          {agentProfileId && (
                            <button
                              type="button"
                              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                              onClick={() => setAgentProfileId(null)}
                            >
                              Clear
                            </button>
                          )}
                        </div>
                        <AgentProfileSelector
                          selectedProfileId={agentProfileId}
                          onSelect={(profile) => {
                            setAgentProfileId(profile.id);
                            // Load agent config into chatbot fields
                            if (profile.config.system_instructions) {
                              setAiChatbotInstructions(
                                profile.config.system_instructions,
                              );
                            }
                            if (profile.config.max_conversation_turns) {
                              setAiChatbotMaxTurns(
                                profile.config.max_conversation_turns,
                              );
                            }
                            if (profile.config.knowledge_document_ids?.length) {
                              setKnowledgeDocumentIds(
                                profile.config.knowledge_document_ids,
                              );
                            }
                          }}
                          onCreateNew={() => setCreateAgentOpen(true)}
                        />
                      </div>

                      {/* Chatbot Instructions */}
                      <div className="space-y-2">
                        <Label htmlFor="ai-instructions">
                          Chatbot Instructions
                        </Label>
                        <ExpandableTextarea
                          id="ai-instructions"
                          aria-invalid={isFieldInvalid("ai-instructions")}
                          expandTitle="Edit Chatbot Instructions"
                          value={aiChatbotInstructions}
                          onChange={(e) => {
                            instructionTouchedRef.current = true;
                            setAiChatbotInstructions(e.target.value);
                          }}
                          placeholder="e.g., You are a helpful sales assistant. Your goal is to qualify leads and book a demo call. Share the free guide link when appropriate."
                          rows={4}
                          required
                        />
                        <p className="text-xs text-muted-foreground">
                          Define the AI's role, goals, and behavior during
                          conversations.
                        </p>
                      </div>

                      {/* Brand Voice */}
                      <div className="space-y-2">
                        <Label htmlFor="brand-voice-select">
                          Brand Voice (optional)
                        </Label>
                        <Select
                          value={aiChatbotBrandVoiceId || "__none__"}
                          onValueChange={(v) =>
                            setAiChatbotBrandVoiceId(v === "__none__" ? "" : v)
                          }
                        >
                          <SelectTrigger id="brand-voice-select">
                            <SelectValue placeholder="Default voice" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">Default</SelectItem>
                            {(brandVoices || []).map((bv) => (
                              <SelectItem key={bv.id} value={bv.id}>
                                {bv.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* AI Model & Max Turns */}
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div
                          className="space-y-2"
                          role="group"
                          aria-labelledby="ai-model-label"
                        >
                          <Label id="ai-model-label">AI Model</Label>
                          <LlmModelSelect
                            value={aiChatbotModel}
                            onValueChange={setAiChatbotModel}
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="max-turns">
                            Max Conversation Turns
                          </Label>
                          <Input
                            id="max-turns"
                            type="number"
                            min={1}
                            max={50}
                            value={aiChatbotMaxTurns}
                            onChange={(e) =>
                              setAiChatbotMaxTurns(
                                parseInt(e.target.value) || 10,
                              )
                            }
                          />
                          <p className="text-xs text-muted-foreground">
                            Auto-handoff after this many turns
                          </p>
                        </div>
                      </div>

                      {/* Knowledge Documents */}
                      <div className="space-y-3 pt-2 border-t">
                        <div className="flex items-center gap-2">
                          <BookOpen className="h-4 w-4 text-muted-foreground" />
                          <Label className="text-sm font-medium">
                            Knowledge Documents For This Campaign (optional)
                          </Label>
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  aria-label="About knowledge documents"
                                  className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                >
                                  <Info
                                    className="h-4 w-4"
                                    aria-hidden="true"
                                  />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs">
                                <p>
                                  Only the documents selected here are used by
                                  this campaign's chatbot.
                                </p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Campaign-scoped retrieval: this chatbot can only
                          reference the documents selected below.
                        </p>

                        {aiChatbotEnabled &&
                          knowledgeDocumentIds.length === 0 && (
                            <div className="rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                              AI chatbot is enabled, but no knowledge documents
                              are linked. The chatbot will reply without
                              product-specific context.
                            </div>
                          )}

                        {knowledgeDocuments && knowledgeDocuments.length > 0 ? (
                          <div className="space-y-2">
                            <div className="flex flex-col gap-2 sm:flex-row">
                              <div className="relative flex-1">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                                <Input
                                  type="text"
                                  aria-label="Search knowledge documents"
                                  placeholder="Search documents..."
                                  value={knowledgeDocumentSearchQuery}
                                  onChange={(e) =>
                                    setKnowledgeDocumentSearchQuery(
                                      e.target.value,
                                    )
                                  }
                                  className="pl-9 h-9 text-sm"
                                />
                              </div>
                              <div className="flex items-center gap-2">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() =>
                                    setKnowledgeDocumentIds(
                                      (knowledgeDocuments || []).map(
                                        (doc) => doc.id,
                                      ),
                                    )
                                  }
                                >
                                  Select all
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setKnowledgeDocumentIds([])}
                                  disabled={knowledgeDocumentIds.length === 0}
                                >
                                  Clear
                                </Button>
                              </div>
                            </div>

                            <p className="text-xs text-muted-foreground">
                              Selected: {knowledgeDocumentIds.length} of{" "}
                              {(knowledgeDocuments || []).length}
                            </p>

                            {filteredKnowledgeDocuments.length === 0 &&
                            knowledgeDocumentSearchQuery ? (
                              <p className="text-xs text-muted-foreground">
                                No documents match "
                                {knowledgeDocumentSearchQuery}".
                              </p>
                            ) : (
                              <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border p-2">
                                {filteredKnowledgeDocuments.map((doc) => {
                                  const isChecked =
                                    knowledgeDocumentIds.includes(doc.id);
                                  return (
                                    <label
                                      key={doc.id}
                                      className="flex items-center gap-3 p-2 rounded-md hover:bg-muted/50 cursor-pointer"
                                    >
                                      <Checkbox
                                        checked={isChecked}
                                        onCheckedChange={(checked) => {
                                          if (checked) {
                                            setKnowledgeDocumentIds((prev) => [
                                              ...prev,
                                              doc.id,
                                            ]);
                                          } else {
                                            setKnowledgeDocumentIds((prev) =>
                                              prev.filter(
                                                (id) => id !== doc.id,
                                              ),
                                            );
                                          }
                                        }}
                                      />
                                      <FileText className="h-4 w-4 text-muted-foreground" />
                                      <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium truncate">
                                          {doc.name}
                                        </p>
                                        {doc.description && (
                                          <p className="text-xs text-muted-foreground truncate">
                                            {doc.description}
                                          </p>
                                        )}
                                      </div>
                                      <span className="text-xs text-muted-foreground">
                                        {doc.chunk_count} chunks
                                      </span>
                                    </label>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            No documents available. Upload documents in the
                            Library → Knowledge Base tab.
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
              {section.id === "limits" && (
                <div className="space-y-5">
                  {/* DM Delay */}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="delay">DM Delay (seconds)</Label>
                      <Input
                        id="delay"
                        aria-invalid={isFieldInvalid("delay")}
                        type="number"
                        min={10}
                        max={300}
                        value={dmDelaySeconds}
                        onChange={(e) =>
                          setDmDelaySeconds(parseInt(e.target.value) || 30)
                        }
                      />
                      <p className="text-xs text-muted-foreground">
                        Wait before sending (10-300s)
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="cooldown">User Cooldown (hours)</Label>
                      <Input
                        id="cooldown"
                        aria-invalid={isFieldInvalid("cooldown")}
                        type="number"
                        min={1}
                        max={168}
                        value={userCooldownHours}
                        onChange={(e) =>
                          setUserCooldownHours(parseInt(e.target.value) || 24)
                        }
                      />
                      <p className="text-xs text-muted-foreground">
                        Ignore same user for this period
                      </p>
                    </div>
                  </div>
                  {/* Rate Limits */}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="hourly">Max DMs per Hour</Label>
                      <Input
                        id="hourly"
                        aria-invalid={isFieldInvalid("hourly")}
                        type="number"
                        min={1}
                        max={50}
                        value={maxDmsPerHour}
                        onChange={(e) =>
                          setMaxDmsPerHour(parseInt(e.target.value) || 10)
                        }
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="daily">Max DMs per Day</Label>
                      <Input
                        id="daily"
                        aria-invalid={isFieldInvalid("daily")}
                        type="number"
                        min={1}
                        max={200}
                        value={maxDmsPerDay}
                        onChange={(e) =>
                          setMaxDmsPerDay(parseInt(e.target.value) || 50)
                        }
                      />
                    </div>
                  </div>
                  {/* Webhook URL - for event notifications */}
                  <div className="space-y-2">
                    <Label htmlFor="webhook">Webhook URL (optional)</Label>
                    <Input
                      id="webhook"
                      aria-invalid={isFieldInvalid("webhook")}
                      type="url"
                      value={webhookUrl}
                      onChange={(e) => setWebhookUrl(e.target.value)}
                      placeholder="https://your-webhook.com/..."
                    />
                    <p className="text-xs text-muted-foreground">
                      Receive notifications for lead_captured, dm_sent,
                      dm_failed events
                    </p>
                  </div>
                </div>
              )}
            </TabsContent>
          ))}
        </div>
      </Tabs>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t bg-background px-4 py-4 sm:px-6">
        <div className="min-w-0 flex-1 basis-40">
          {submitError ? (
            <p role="alert" className="text-sm text-destructive">
              {submitError}
            </p>
          ) : validationIssues.length ? (
            <button
              type="button"
              onClick={() => {
                setValidationAttempted(true);
                showIssue(validationIssues[0]);
              }}
              className="flex items-start gap-2 rounded text-left text-xs text-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-amber-300"
            >
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{validationIssues[0].message}</span>
              <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            </button>
          ) : (
            <p className="text-xs text-muted-foreground">
              {initialData
                ? "Changes apply to this campaign."
                : "Create your campaign, then add a post to monitor."}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button variant="cta" type="submit" disabled={isLoading}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isLoading
              ? "Saving..."
              : initialData
                ? "Save changes"
                : "Create lead magnet"}
          </Button>
        </div>
      </div>
      <CreateAgentDialog
        open={createAgentOpen}
        onOpenChange={setCreateAgentOpen}
        onCreated={(profile) => {
          setAgentProfileId(profile.id);
          if (profile.config.system_instructions) {
            setAiChatbotInstructions(profile.config.system_instructions);
          }
          if (profile.config.max_conversation_turns) {
            setAiChatbotMaxTurns(profile.config.max_conversation_turns);
          }
          if (profile.config.knowledge_document_ids?.length) {
            setKnowledgeDocumentIds(profile.config.knowledge_document_ids);
          }
        }}
      />
    </form>
  );
}
