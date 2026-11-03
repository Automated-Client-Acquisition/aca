import { useState, useRef, useCallback, useEffect } from "react";
import { openConsentPopup } from "@/lib/open-consent-popup";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { invokeEdgeFunction } from "@/lib/supabase-functions";
import { useAuth } from "@/contexts/AuthContext";
import { useApiKeys } from "@/hooks/useApiKeys";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  Trash2,
  Mail,
  Loader2,
  AlertCircle,
  ListPlus,
  Wifi,
  Sparkles,
  RefreshCw,
  PenLine,
  Upload,
  MoreHorizontal,
  ImagePlus,
  XCircle,
  Shield,
  Unplug,
  Flame,
  KeyRound,
  ExternalLink,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useCreateM365Mailbox,
  useDeleteM365Mailbox,
  useStartBulkCreateM365Mailboxes,
  useActiveMailboxProvisioningJob,
  useCancelMailboxProvisioningJob,
  useWatchMailboxProvisioningCompletion,
  type MailboxProvisioningJob,
} from "@/hooks/useM365Mailboxes";
import { useInitiateExoConsent } from "@/hooks/useM365Tenants";
import { useGenerateSignatures } from "@/hooks/useEmailSendingDomains";
import { useBulkUpdateMailboxes } from "@/hooks/useEmailMailboxes";
import { BulkSignatureDialog } from "@/components/email/BulkSignatureDialog";
import type { EmailSendingDomain, EmailMailbox, M365Tenant } from "@/types/email";

// ── Types ─────────────────────────────────────────────────────────────────────

interface MailboxRow {
  id: string;
  email_address: string;
  display_name: string | null;
  status: string;
  imap_connected: boolean;
  metadata: Record<string, unknown> | null;
  last_error?: string | null;
}

/**
 * Translate raw mailbox state into a friendly "why" sentence shown under the
 * email address. Maps known SMTP error fragments to actionable explanations.
 */
function getMailboxStatusReason(mailbox: MailboxRow): string {
  if (mailbox.status === "pending") {
    return "Waiting for Microsoft to finish provisioning the mailbox (1-3 min)";
  }
  const err = (mailbox.last_error || "").toLowerCase();
  if (err.includes("5.7.139") || err.includes("security defaults")) {
    return "Security Defaults is blocking SMTP. Disable in Entra ID > Overview > Properties > Manage security defaults > Disabled > Save. Then retest.";
  }
  if (err.includes("smtpclientauthentication is disabled")) {
    return "Tenant SMTP AUTH still being enabled - auto-retesting every 10 min";
  }
  if (err.includes("5.7.3") || err.includes("authentication unsuccessful")) {
    return "Mailbox SMTP login failing - auto-retesting every 10 min";
  }
  if (err.includes("5.7.57")) {
    return "Mailbox not yet authenticated as sender — auto-retesting every 10 min";
  }
  if (err) return mailbox.last_error!;
  return "Connection check pending — will auto-retest within 10 min";
}

interface MailboxProvisioningPanelProps {
  domain: EmailSendingDomain;
  // tenant is accepted but not required for rendering — kept for callers
  tenant?: M365Tenant;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getAvatarUrl(mailbox: MailboxRow): string {
  const avatarUrl = (mailbox.metadata as Record<string, unknown>)?.avatar_url as string | undefined;
  if (avatarUrl) return avatarUrl;
  const name = encodeURIComponent(mailbox.display_name || mailbox.email_address);
  return `https://ui-avatars.com/api/?name=${name}&background=random&size=40`;
}

function MailboxStatusBadge({
  status,
  imapConnected,
  isRetesting,
}: {
  status: string;
  imapConnected?: boolean;
  isRetesting?: boolean;
}) {
  if (isRetesting) {
    return (
      <Badge variant="outline" className="border-amber-500/30 text-amber-400 bg-amber-500/10 text-xs">
        <Loader2 className="w-2.5 h-2.5 mr-1 animate-spin" />
        verifying...
      </Badge>
    );
  }
  // A "ready" mailbox with no live connection can't actually send — flag it.
  if (status === "ready" && imapConnected === false) {
    return (
      <Badge variant="outline" className="border-orange-500/30 text-orange-400 bg-orange-500/10 text-xs">
        <Unplug className="w-2.5 h-2.5 mr-1" />
        reconnect
      </Badge>
    );
  }
  if (status === "ready") {
    return (
      <Badge variant="outline" className="border-green-500/30 text-green-400 bg-green-500/10 text-xs">
        ready
      </Badge>
    );
  }
  // "warming" = provisioned and connected, ramping up via the warmup mesh.
  // Not a provisioning state — it used to share the spinner and read as stuck.
  if (status === "warming") {
    return (
      <Badge variant="outline" className="border-orange-500/30 text-orange-400 bg-orange-500/10 text-xs">
        <Flame className="w-2.5 h-2.5 mr-1" />
        warming
      </Badge>
    );
  }
  if (status === "pending") {
    return (
      <Badge variant="outline" className="border-amber-500/30 text-amber-400 bg-amber-500/10 text-xs">
        <Loader2 className="w-2.5 h-2.5 mr-1 animate-spin" />
        provisioning...
      </Badge>
    );
  }
  if (status === "error") {
    return <Badge variant="destructive" className="text-xs">{status}</Badge>;
  }
  return <Badge variant="secondary" className="text-xs">{status}</Badge>;
}

function parseBulkLines(text: string): Array<{ username: string; display_name: string }> {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const commaIdx = line.indexOf(",");
      if (commaIdx === -1) return { username: line.toLowerCase(), display_name: line };
      return {
        username: line.slice(0, commaIdx).trim().toLowerCase(),
        display_name: line.slice(commaIdx + 1).trim(),
      };
    })
    .filter((m) => m.username.length > 0);
}

// ── Component ─────────────────────────────────────────────────────────────────

export function MailboxProvisioningPanel({ domain, tenant }: MailboxProvisioningPanelProps) {
  const { currentOrganization, isClient } = useAuth();
  const queryClient = useQueryClient();
  const initiateExoConsent = useInitiateExoConsent();

  const [showAddForm, setShowAddForm] = useState(false);
  const [showBulkDialog, setShowBulkDialog] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; email: string } | null>(null);
  const [newUsername, setNewUsername] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [bulkText, setBulkText] = useState("");
  const [generateCount, setGenerateCount] = useState(10);
  const [generateNiche, setGenerateNiche] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  // Set when the server reports no OpenRouter key even though the client
  // couldn't tell (client orgs inherit their agency's key, which RLS hides).
  const [serverKeyMissing, setServerKeyMissing] = useState(false);
  const [bulkStopping, setBulkStopping] = useState(false);
  const [generateAvatars, setGenerateAvatars] = useState(false);

  // Avatar edit popover state
  const [avatarEditId, setAvatarEditId] = useState<string | null>(null);
  const [avatarGeneratingIds, setAvatarGeneratingIds] = useState<Set<string>>(new Set());
  const [avatarCustomUrl, setAvatarCustomUrl] = useState("");

  // Tracks the async bulk provisioning job for this domain. Once set, the
  // panel polls mailbox_provisioning_jobs and renders live progress. Survives
  // page refresh because useActiveMailboxProvisioningJob re-discovers the
  // in-flight job by domain_id on mount.
  const [bulkJobId, setBulkJobId] = useState<string | null>(null);

  // Signature generation during bulk create
  const [generateSignaturesOnCreate, setGenerateSignaturesOnCreate] = useState(false);
  const [sigCompanyName, setSigCompanyName] = useState("");
  const [sigCompanyWebsite, setSigCompanyWebsite] = useState("");
  const [sigStyle, setSigStyle] = useState<"professional" | "modern" | "minimal">("professional");
  const [sigProgress, setSigProgress] = useState<string | null>(null);

  // Bulk signature dialog for existing mailboxes
  const [showBulkSignatureDialog, setShowBulkSignatureDialog] = useState(false);

  const generateSignatures = useGenerateSignatures();
  const bulkUpdateMailboxes = useBulkUpdateMailboxes();

  // Auto-retest countdown after bulk create
  const [autoRetestCountdown, setAutoRetestCountdown] = useState<number | null>(null);
  const autoRetestTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Options captured when bulk job is started. Consumed by runPostJobWork when
  // the job completes so signature + retest settings aren't lost if the user
  // navigates away before the job finishes.
  const pendingPostJobRef = useRef<{
    toCreate: Array<{ username: string; display_name: string }>;
    generateSignatures: boolean;
    sigCompanyName: string;
    sigCompanyWebsite: string;
    sigStyle: "professional" | "modern" | "minimal";
  } | null>(null);

  // M365 avatar sync + bulk generation state
  const avatarGenCancelRef = useRef(false);
  const [syncingAvatars, setSyncingAvatars] = useState(false);
  const [generatingAllAvatars, setGeneratingAllAvatars] = useState(false);
  const [avatarGenCancelling, setAvatarGenCancelling] = useState(false);
  const [avatarGenCurrentId, setAvatarGenCurrentId] = useState<string | null>(null);
  const [avatarGenDoneIds, setAvatarGenDoneIds] = useState<Set<string>>(new Set());
  const [avatarGenFailedIds, setAvatarGenFailedIds] = useState<Set<string>>(new Set());
  const [avatarGenProgress, setAvatarGenProgress] = useState<{ done: number; total: number } | null>(null);

  const [retestingIds, setRetestingIds] = useState<Set<string>>(new Set());
  const [retestingAll, setRetestingAll] = useState(false);

  const createMailbox = useCreateM365Mailbox();
  const deleteMailbox = useDeleteM365Mailbox();
  const startBulkJob = useStartBulkCreateM365Mailboxes();
  const cancelBulkJob = useCancelMailboxProvisioningJob();

  // Re-discover any in-flight job for this domain on mount so a refresh or
  // cross-device visit picks back up on live progress.
  const { data: activeJob } = useActiveMailboxProvisioningJob(domain.id);
  const trackedJobId = bulkJobId ?? activeJob?.id ?? null;

  const { data: mailboxes = [], isLoading } = useQuery({
    queryKey: ["email-mailboxes", currentOrganization?.id, domain.id],
    queryFn: async () => {
      if (!currentOrganization) return [];
      const { data, error } = await supabase
        .from("email_mailboxes")
        .select("id, email_address, display_name, status, imap_connected, metadata")
        .eq("sending_domain_id", domain.id)
        .eq("connection_type", "m365")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as MailboxRow[];
    },
    enabled: !!currentOrganization && !!domain.id,
    refetchInterval: (trackedJobId || retestingIds.size > 0) ? 2000 : false,
  });

  const isNotVerified = !domain.m365_domain_verified;

  // AI names and avatars run on the org's own OpenRouter key. Client orgs may
  // inherit their agency's key, which we can't read here, so let the server
  // decide for them.
  const { data: apiKeys, isLoading: apiKeysLoading, refetch: refetchApiKeys } = useApiKeys();
  const openRouterKeys = (apiKeys ?? []).filter((k) => k.provider === "openrouter");
  const aiKeyStatus: "ok" | "missing" | "invalid" =
    isClient || apiKeysLoading || openRouterKeys.some((k) => k.is_valid)
      ? "ok"
      : openRouterKeys.length > 0
        ? "invalid"
        : "missing";
  const aiBlocked = aiKeyStatus !== "ok";
  const showKeyCallout = aiBlocked || serverKeyMissing;

  // The "Add key" link opens Settings in a new tab; re-check when the user
  // comes back so the callout clears without reopening the dialog.
  useEffect(() => {
    if (!showBulkDialog || !showKeyCallout) return;
    const onFocus = () => {
      setServerKeyMissing(false);
      refetchApiKeys();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [showBulkDialog, showKeyCallout, refetchApiKeys]);

  const handleCreateMailbox = async () => {
    if (!newUsername.trim() || !newDisplayName.trim()) return;
    if (existingUsernames.has(newUsername.trim().toLowerCase())) {
      toast.error(`Username "${newUsername.trim().toLowerCase()}" already exists on this domain`);
      return;
    }
    await createMailbox.mutateAsync({
      domain_id: domain.id,
      username: newUsername.trim().toLowerCase(),
      display_name: newDisplayName.trim(),
    });
    setNewUsername("");
    setNewDisplayName("");
    setShowAddForm(false);
  };

  const handleGenerate = async () => {
    if (isGenerating || aiBlocked) return;
    setIsGenerating(true);
    setGenerateError(null);
    setServerKeyMissing(false);
    try {
      // Names only. Avatars are generated server-side by the bulk create job
      // when the toggle is on; doing them here meant one request rendering up
      // to 100 images, which outran the edge function's time limit.
      const data = await invokeEdgeFunction<{ text?: string }>("generate-mailbox-names", {
        count: generateCount,
        niche: generateNiche,
        existing_usernames: Array.from(existingUsernames),
      });
      // Strip gender/ethnicity fields if present (LLM outputs: username, Display Name, gender, ethnicity)
      const lines = (data?.text ?? "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const parts = line.split(",").map((p) => p.trim());
          if (parts.length >= 4) return `${parts[0]}, ${parts[1]}`;
          return line;
        });
      if (lines.length === 0) throw new Error("The AI returned no names. Try again.");
      const cleanText = lines.join("\n");
      setBulkText((prev) => (prev ? prev + "\n" + cleanText : cleanText));
      toast.success(`Generated ${lines.length} name${lines.length !== 1 ? "s" : ""}`);
    } catch (err) {
      console.error("Generate failed:", err);
      const message = err instanceof Error ? err.message : String(err);
      if (message.toLowerCase().includes("openrouter api key not configured")) {
        setServerKeyMissing(true);
      } else {
        setGenerateError(message);
      }
    } finally {
      setIsGenerating(false);
    }
  };

  const handleBulkCreate = async () => {
    const parsed = parseBulkLines(bulkText);
    if (parsed.length === 0) return;

    // Filter out usernames that already exist on this domain
    const existing = new Set(mailboxes.map((m) => m.email_address.split("@")[0].toLowerCase()));
    const toCreate = parsed.filter((p) => !existing.has(p.username));
    if (toCreate.length === 0) {
      toast.error("All usernames already exist on this domain");
      return;
    }
    if (toCreate.length < parsed.length) {
      toast.warning(`Skipping ${parsed.length - toCreate.length} duplicate username(s)`);
    }

    setBulkStopping(false);

    // Capture options used for post-completion work so later state changes
    // don't affect what runs after the job finishes.
    pendingPostJobRef.current = {
      toCreate,
      generateSignatures: generateSignaturesOnCreate,
      sigCompanyName,
      sigCompanyWebsite,
      sigStyle,
    };

    try {
      const { job_id } = await startBulkJob.mutateAsync({
        domain_id: domain.id,
        mailboxes: toCreate.map((p) => ({
          username: p.username,
          display_name: p.display_name,
        })),
        // When the toggle is on, the background job generates an AI headshot for
        // every mailbox (AI-generated or manually pasted names alike). Durable —
        // survives closing the dialog, no manual regeneration needed afterwards.
        generate_avatars: generateAvatars && !aiBlocked,
      });
      setBulkJobId(job_id);
      toast.success(
        generateAvatars && !aiBlocked
          ? `Provisioning ${toCreate.length} mailboxes with AI avatars in the background. You can close this dialog — we'll notify you when it's done.`
          : `Provisioning ${toCreate.length} mailboxes in the background. You can close this dialog — we'll notify you when it's done.`
      );
    } catch {
      // mutation's onError already surfaces the toast
      pendingPostJobRef.current = null;
    }
  };

  // Runs once per completed job: signature generation (if requested) +
  // 45s auto-retest. Pulled out of handleBulkCreate so it can fire even if
  // the user closed the dialog or refreshed the page while the job was running.
  const runPostJobWork = useCallback(async (job: MailboxProvisioningJob) => {
    if (!currentOrganization) return;
    const opts = pendingPostJobRef.current;
    pendingPostJobRef.current = null;
    if (job.status !== "completed" || job.created_count === 0) return;

    if (opts?.generateSignatures) {
      setSigProgress("Generating signatures...");
      try {
        const { data: freshMailboxes } = await supabase
          .from("email_mailboxes")
          .select("id, email_address, display_name, metadata")
          .in("id", job.created_mailbox_ids);

        if (freshMailboxes && freshMailboxes.length > 0) {
          const identities = freshMailboxes.map((m) => {
            const displayName = m.display_name || m.email_address.split("@")[0];
            const parts = displayName.split(/[\s.]+/);
            return {
              first_name: parts[0] || displayName,
              last_name: parts.slice(1).join(" ") || "",
              email: m.email_address,
              avatar_url: (m.metadata as Record<string, unknown>)?.avatar_url as string | undefined,
            };
          });

          setSigProgress(`Generating ${freshMailboxes.length} signatures...`);
          const result = await generateSignatures.mutateAsync({
            identities,
            domain: domain.domain,
            company_name: opts.sigCompanyName || undefined,
            company_website: opts.sigCompanyWebsite || undefined,
            style: opts.sigStyle,
          });

          setSigProgress("Applying signatures...");
          for (const sig of result.signatures) {
            const mb = freshMailboxes[sig.index];
            if (mb && sig.signature_html) {
              await bulkUpdateMailboxes.mutateAsync({
                ids: [mb.id],
                metadataUpdates: { signature: sig.signature_html },
              });
            }
          }
        }
      } catch (err) {
        console.error("Signature generation failed:", err);
      } finally {
        setSigProgress(null);
      }
    }

    // Close dialog + reset bulk text if no errors
    if (job.failed_count === 0) {
      setBulkText("");
      setShowBulkDialog(false);
    }

    // Auto-retest after 45s (M365 provisioning delay before SMTP works)
    const RETEST_DELAY = 45;
    setAutoRetestCountdown(RETEST_DELAY);
    if (autoRetestTimerRef.current) clearInterval(autoRetestTimerRef.current);
    autoRetestTimerRef.current = setInterval(() => {
      setAutoRetestCountdown(prev => {
        if (prev === null || prev <= 1) {
          if (autoRetestTimerRef.current) clearInterval(autoRetestTimerRef.current);
          autoRetestTimerRef.current = null;
          return null;
        }
        return prev - 1;
      });
    }, 1000);

    await new Promise(resolve => setTimeout(resolve, RETEST_DELAY * 1000));
    setAutoRetestCountdown(null);
    toast.info("Auto-retesting newly created mailboxes...");
    setRetestingAll(true);
    try {
      const { data: currentMailboxes } = await supabase
        .from("email_mailboxes")
        .select("id, email_address, display_name, status, imap_connected, metadata")
        .eq("sending_domain_id", domain.id)
        .eq("connection_type", "m365");
      const nonReady = (currentMailboxes ?? []).filter(m => m.status !== "ready");
      for (const mb of nonReady) {
        await supabase.functions.invoke("infra-mailbox-provision", {
          body: { action: "retest", mailbox_id: mb.id, organization_id: currentOrganization.id },
        });
      }
      await queryClient.refetchQueries({ queryKey: ["email-mailboxes", currentOrganization.id, domain.id] });
    } finally {
      setRetestingAll(false);
    }
  }, [currentOrganization, domain.domain, domain.id, generateSignatures, bulkUpdateMailboxes, queryClient]);

  // Watch the in-flight job and run post-completion work when it finishes.
  // Also clears local state so the next run starts fresh.
  const { job: watchedJob } = useWatchMailboxProvisioningCompletion(trackedJobId, (finishedJob) => {
    runPostJobWork(finishedJob);
    setBulkJobId(null);
  });

  // Derived progress shape consumed by the existing UI blocks.
  const bulkProgress = watchedJob
    ? {
        total: watchedJob.total,
        done: watchedJob.processed_index,
        current: watchedJob.current_username ?? "",
        errors: watchedJob.errors,
        running: watchedJob.status === "pending" || watchedJob.status === "running",
      }
    : null;

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await deleteMailbox.mutateAsync(deleteTarget.id);
    setDeleteTarget(null);
  };

  const runRepairOrRetest = async (mb: MailboxRow) => {
    if (!currentOrganization) return;
    const action = mb.status === 'disconnected' || !mb.imap_connected ? 'repair' : 'retest';
    setRetestingIds(prev => new Set(prev).add(mb.id));
    try {
      await supabase.functions.invoke("infra-mailbox-provision", {
        body: { action, mailbox_id: mb.id, organization_id: currentOrganization.id },
      });
      await queryClient.refetchQueries({ queryKey: ["email-mailboxes", currentOrganization.id, domain.id] });
    } finally {
      setRetestingIds(prev => { const s = new Set(prev); s.delete(mb.id); return s; });
    }
  };

  const handleRetest = (mailboxId: string) => {
    const mb = mailboxes.find(m => m.id === mailboxId);
    if (mb) runRepairOrRetest(mb);
  };

  const handleRetestAll = async () => {
    if (!currentOrganization || mailboxes.length === 0) return;
    setRetestingAll(true);
    for (const mb of mailboxes) {
      await runRepairOrRetest(mb);
    }
    setRetestingAll(false);
  };

  const handleRepair = (mailbox: MailboxRow) => runRepairOrRetest(mailbox);

  const handleSyncAllAvatars = async () => {
    if (!currentOrganization) return;
    setSyncingAvatars(true);
    try {
      const { data, error } = await supabase.functions.invoke("infra-mailbox-provision", {
        body: { action: "sync_avatars", domain_id: domain.id, organization_id: currentOrganization.id },
      });
      if (error) throw new Error(error.message);
      console.log("Avatar sync result:", data);
      if (data?.synced > 0 && (!data.errors || data.errors.length === 0)) {
        toast.success(`Synced ${data.synced} avatar(s) to M365`);
      } else if (data?.synced > 0 && data.errors?.length > 0) {
        toast.warning(`Synced ${data.synced} avatar(s), ${data.errors.length} failed: ${data.errors.map((e: { email: string }) => e.email).join(', ')}`);
      } else if (data?.errors?.length > 0) {
        toast.error(`Avatar sync failed for ${data.errors.length} mailbox(es): ${data.errors.map((e: { email: string; error: string }) => `${e.email}: ${e.error}`).join('; ')}`);
      } else {
        toast.info("No mailboxes with avatars to sync");
      }
    } catch (err) {
      console.error("Sync avatars failed:", err);
      toast.error(`Avatar sync failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSyncingAvatars(false);
    }
  };

  const handleGenerateAllAvatars = async () => {
    if (!currentOrganization || mailboxes.length === 0) return;
    // Only generate for mailboxes missing a real avatar (placeholder or no avatar)
    const needsAvatar = mailboxes.filter((mb) => {
      const url = (mb.metadata as Record<string, unknown>)?.avatar_url as string | undefined;
      return !url || url.includes("ui-avatars.com");
    });
    if (needsAvatar.length === 0) {
      toast.info("All mailboxes already have avatars");
      return;
    }
    avatarGenCancelRef.current = false;
    setAvatarGenCancelling(false);
    setGeneratingAllAvatars(true);
    setAvatarGenProgress({ done: 0, total: needsAvatar.length });
    setAvatarGenDoneIds(new Set());
    setAvatarGenFailedIds(new Set());
    let successCount = 0;
    let failCount = 0;
    try {
      for (let i = 0; i < needsAvatar.length; i++) {
        if (avatarGenCancelRef.current) {
          toast.info(`Avatar generation cancelled (${successCount} done, ${needsAvatar.length - i} skipped)`);
          break;
        }
        const mb = needsAvatar[i];
        setAvatarGenCurrentId(mb.id);
        try {
          const { data, error } = await supabase.functions.invoke("generate-mailbox-names", {
            body: { avatar_only: true, display_name: mb.display_name, generate_avatars: true },
          });
          if (error) {
            const errMsg = error instanceof Error ? error.message : typeof error === "object" && error !== null && "message" in error ? (error as { message: string }).message : String(error);
            throw new Error(errMsg);
          }
          if (!data) throw new Error("Empty response from generate-mailbox-names");
          if (data.avatarErrors?.length) {
            console.warn(`[Avatar Gen] Server errors for ${mb.email_address}:`, data.avatarErrors);
          }
          const avatarUrl = data?.avatars && Object.values(data.avatars)[0] as string | undefined;
          if (!avatarUrl) {
            const serverErr = data.avatarErrors?.[0];
            const detail = serverErr ? `${serverErr.error}: ${serverErr.debug || ''}` : JSON.stringify(data).slice(0, 200);
            console.warn(`[Avatar Gen] No avatar URL for ${mb.email_address}:`, detail);
            throw new Error(serverErr?.error || "No avatar image returned by AI model");
          }
          const { error: updateError } = await supabase.functions.invoke("infra-mailbox-provision", {
            body: { action: "update", mailbox_id: mb.id, organization_id: currentOrganization.id, avatar_url: avatarUrl },
          });
          if (updateError) throw new Error(`Failed to save avatar: ${updateError}`);
          setAvatarGenDoneIds(prev => new Set(prev).add(mb.id));
          successCount++;
        } catch (err) {
          console.error(`[Avatar Gen] Failed for ${mb.email_address}:`, err);
          setAvatarGenFailedIds(prev => new Set(prev).add(mb.id));
          failCount++;
        }
        setAvatarGenProgress({ done: i + 1, total: needsAvatar.length });
      }
      await queryClient.refetchQueries({ queryKey: ["email-mailboxes", currentOrganization.id, domain.id] });

      // Refresh signatures for mailboxes that got new avatars and had existing signatures
      if (successCount > 0) {
        const { data: updatedMailboxes } = await supabase
          .from("email_mailboxes")
          .select("id, email_address, display_name, metadata")
          .eq("sending_domain_id", domain.id)
          .eq("connection_type", "m365");
        const withSigs = (updatedMailboxes || []).filter((m) => {
          const meta = m.metadata as Record<string, unknown> | null;
          return meta?.signature && meta?.avatar_url && !(meta.avatar_url as string).includes("ui-avatars.com");
        });
        if (withSigs.length > 0) {
          const identities = withSigs.map((m) => {
            const displayName = m.display_name || m.email_address.split("@")[0];
            const parts = displayName.split(/[\s.]+/);
            return {
              first_name: parts[0] || displayName,
              last_name: parts.slice(1).join(" ") || "",
              email: m.email_address,
              avatar_url: (m.metadata as Record<string, unknown>)?.avatar_url as string,
            };
          });
          try {
            const sigResult = await generateSignatures.mutateAsync({
              identities,
              domain: domain.domain,
              style: "professional",
            });
            for (const sig of sigResult.signatures) {
              const mb = withSigs[sig.index];
              if (mb && sig.signature_html) {
                await bulkUpdateMailboxes.mutateAsync({
                  ids: [mb.id],
                  metadataUpdates: { signature: sig.signature_html },
                });
              }
            }
          } catch (err) {
            console.warn("[Bulk Avatar] Signature refresh failed:", err);
          }
        }
      }

      if (failCount > 0) {
        toast.error(`Avatar generation: ${successCount} succeeded, ${failCount} failed. Check console for details.`);
      } else if (successCount > 0) {
        toast.success(`Generated ${successCount} avatar${successCount !== 1 ? "s" : ""} successfully`);
      }
    } finally {
      setGeneratingAllAvatars(false);
      setAvatarGenCancelling(false);
      setAvatarGenCurrentId(null);
      // Keep done/failed IDs visible for a few seconds after completion
      setTimeout(() => {
        setAvatarGenDoneIds(new Set());
        setAvatarGenFailedIds(new Set());
        setAvatarGenProgress(null);
      }, 3000);
    }
  };

  const handleCancelAvatarGen = () => {
    avatarGenCancelRef.current = true;
    setAvatarGenCancelling(true);
  };

  // Refresh a mailbox's signature with its current avatar_url
  const refreshSignatureWithAvatar = async (mailboxId: string, displayName: string, email: string, avatarUrl: string) => {
    try {
      const parts = displayName.split(/[\s.]+/);
      const result = await generateSignatures.mutateAsync({
        identities: [{
          first_name: parts[0] || displayName,
          last_name: parts.slice(1).join(" ") || "",
          email,
          avatar_url: avatarUrl,
        }],
        domain: domain.domain,
        style: "professional",
      });
      if (result.signatures?.[0]?.signature_html) {
        await bulkUpdateMailboxes.mutateAsync({
          ids: [mailboxId],
          metadataUpdates: { signature: result.signatures[0].signature_html },
        });
      }
    } catch (err) {
      console.warn("[Signature Refresh] Failed:", err);
    }
  };

  const handleAvatarRegenerate = async (mailbox: MailboxRow) => {
    if (!currentOrganization) return;
    setAvatarGeneratingIds((prev) => new Set(prev).add(mailbox.id));
    try {
      const { data, error } = await supabase.functions.invoke("generate-mailbox-names", {
        body: { avatar_only: true, display_name: mailbox.display_name, generate_avatars: true },
      });
      if (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        throw new Error(errMsg);
      }
      if (!data) throw new Error("Empty response");
      if (data.avatarErrors?.length) {
        console.warn("[Avatar Regen] Server errors:", data.avatarErrors);
      }
      const avatarUrl = data?.avatars && Object.values(data.avatars)[0] as string | undefined;
      if (!avatarUrl) {
        const serverErr = data.avatarErrors?.[0];
        throw new Error(serverErr?.error || "No avatar image returned by AI model");
      }
      await supabase.functions.invoke("infra-mailbox-provision", {
        body: { action: "update", mailbox_id: mailbox.id, organization_id: currentOrganization.id, avatar_url: avatarUrl },
      });
      // Refresh signature with new avatar if mailbox has one
      const existingSig = (mailbox.metadata as Record<string, unknown>)?.signature;
      if (existingSig) {
        await refreshSignatureWithAvatar(mailbox.id, mailbox.display_name, mailbox.email_address, avatarUrl);
      }
      await queryClient.refetchQueries({ queryKey: ["email-mailboxes", currentOrganization.id, domain.id] });
      setAvatarEditId(null);
      toast.success("Avatar regenerated");
    } catch (err) {
      console.error("Avatar regeneration failed:", err);
      toast.error(`Avatar generation failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setAvatarGeneratingIds((prev) => { const next = new Set(prev); next.delete(mailbox.id); return next; });
    }
  };

  const handleAvatarUrlSave = async (mailbox: MailboxRow) => {
    if (!currentOrganization || !avatarCustomUrl.trim()) return;
    try {
      const newUrl = avatarCustomUrl.trim();
      await supabase.functions.invoke("infra-mailbox-provision", {
        body: { action: "update", mailbox_id: mailbox.id, organization_id: currentOrganization.id, avatar_url: newUrl },
      });
      const existingSig = (mailbox.metadata as Record<string, unknown>)?.signature;
      if (existingSig) {
        await refreshSignatureWithAvatar(mailbox.id, mailbox.display_name, mailbox.email_address, newUrl);
      }
      await queryClient.refetchQueries({ queryKey: ["email-mailboxes", currentOrganization.id, domain.id] });
      setAvatarEditId(null);
      setAvatarCustomUrl("");
    } catch (err) {
      console.error("Avatar URL save failed:", err);
    }
  };

  const bulkParsed = parseBulkLines(bulkText);

  // Duplicate detection: check new names against existing mailboxes
  const existingUsernames = new Set(
    mailboxes.map((m) => m.email_address.split("@")[0].toLowerCase())
  );
  const bulkDuplicates = bulkParsed.filter((p) => existingUsernames.has(p.username));
  const bulkNew = bulkParsed.filter((p) => !existingUsernames.has(p.username));
  const singleDuplicate = newUsername.trim() ? existingUsernames.has(newUsername.trim().toLowerCase()) : false;

  // Gate: require EXO consent before allowing mailbox creation
  if (tenant && !tenant.exo_consent_granted) {
    return (
      <div className="space-y-3 pt-2">
        <Alert className="border-amber-500/30 bg-amber-500/5">
          <Shield className="w-4 h-4 text-amber-400" />
          <AlertDescription className="text-sm">
            <span className="font-medium text-amber-400">Exchange Online access required</span>
            <p className="text-muted-foreground mt-1">
              Mailbox creation requires Exchange Online permissions. Grant admin consent for the Exchange app on this tenant to continue.
            </p>
            <Button
              variant="cta"
              size="sm"
              className="mt-3"
              disabled={initiateExoConsent.isPending}
              onClick={async () => {
                try {
                  const result = await initiateExoConsent.mutateAsync(tenant.id);
                  if (result.consent_url) {
                    openConsentPopup(result.consent_url);
                  }
                } catch {
                  // Error handled by mutation's onError
                }
              }}
            >
              {initiateExoConsent.isPending ? (
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              ) : (
                <Shield className="w-3.5 h-3.5 mr-1.5" />
              )}
              Grant Exchange Access
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-3 pt-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
          <Mail className="w-3.5 h-3.5" />
          Mailboxes{" "}
          <Badge variant="secondary" className="text-xs normal-case tracking-normal">
            {mailboxes.length}/100
          </Badge>
        </span>
        <div className="flex items-center gap-2">
          {mailboxes.length > 0 && (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-7 text-xs">
                    <MoreHorizontal className="w-3 h-3 mr-1" />
                    Actions
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={handleGenerateAllAvatars}
                    disabled={generatingAllAvatars}
                  >
                    <ImagePlus className="w-3.5 h-3.5 mr-2" />
                    {generatingAllAvatars
                      ? `Generating avatars (${avatarGenProgress?.done ?? 0}/${avatarGenProgress?.total ?? 0})...`
                      : "Generate AI Avatars"}
                  </DropdownMenuItem>
                  {domain.infra_type === "m365" && (
                    <DropdownMenuItem
                      onClick={handleSyncAllAvatars}
                      disabled={syncingAvatars}
                    >
                      <Upload className="w-3.5 h-3.5 mr-2" />
                      {syncingAvatars ? "Syncing..." : "Sync Avatars to M365"}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={() => setShowBulkSignatureDialog(true)}>
                    <PenLine className="w-3.5 h-3.5 mr-2" />
                    Bulk Signatures
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={handleRetestAll}
                    disabled={retestingAll}
                  >
                    <RefreshCw className="w-3.5 h-3.5 mr-2" />
                    Retest All
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setShowBulkDialog(true)}
            disabled={isNotVerified}
          >
            <ListPlus className="w-3 h-3 mr-1" />
            Bulk Add
          </Button>
          <Button
            variant="cta"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setShowAddForm((v) => !v)}
            disabled={isNotVerified}
          >
            <Plus className="w-3 h-3 mr-1" />
            Add Mailbox
          </Button>
        </div>
      </div>

      {/* Persistent bulk provisioning banner. Surfaces in-flight job progress
          outside the Bulk Add dialog so the user can close the dialog and
          still see progress, or pick it up on a fresh page load. */}
      {bulkProgress && bulkProgress.running && (
        <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-2.5 space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground flex items-center gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin text-blue-400" />
              Provisioning{" "}
              {bulkProgress.current && (
                <span className="font-mono font-medium">{bulkProgress.current}</span>
              )}
              ...
            </span>
            <div className="flex items-center gap-2">
              <span className="font-medium text-blue-400">
                {bulkProgress.done}/{bulkProgress.total}
              </span>
              <button
                onClick={() => setShowBulkDialog(true)}
                className="text-muted-foreground hover:text-foreground transition-colors underline-offset-2 hover:underline"
              >
                Details
              </button>
              {trackedJobId && (
                <button
                  onClick={async () => {
                    setBulkStopping(true);
                    try { await cancelBulkJob.mutateAsync(trackedJobId); }
                    finally { setBulkStopping(false); }
                  }}
                  disabled={bulkStopping}
                  className="text-muted-foreground hover:text-red-400 transition-colors"
                  title="Cancel provisioning"
                >
                  <XCircle className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-all duration-500"
              style={{ width: `${(bulkProgress.done / bulkProgress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Bulk avatar generation progress */}
      {avatarGenProgress && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground flex items-center gap-1.5">
              {generatingAllAvatars ? (
                <Loader2 className="w-3 h-3 animate-spin text-amber-500" />
              ) : (
                <Sparkles className="w-3 h-3 text-amber-500" />
              )}
              {avatarGenCancelling ? "Cancelling after current avatar..." : generatingAllAvatars ? "Generating AI avatars..." : "Avatar generation complete"}
            </span>
            <div className="flex items-center gap-2">
              <span className="font-medium text-amber-500">
                {avatarGenProgress.done}/{avatarGenProgress.total}
              </span>
              {generatingAllAvatars && (
                avatarGenCancelling ? (
                  <span className="text-xs text-red-400 flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Cancelling...
                  </span>
                ) : (
                  <button
                    onClick={handleCancelAvatarGen}
                    className="text-muted-foreground hover:text-red-400 transition-colors"
                    title="Cancel generation"
                  >
                    <XCircle className="w-4 h-4" />
                  </button>
                )
              )}
            </div>
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-amber-500 transition-all duration-500"
              style={{ width: `${(avatarGenProgress.done / avatarGenProgress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Auto-retest countdown */}
      {autoRetestCountdown !== null && (
        <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-2.5 space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground flex items-center gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin text-blue-400" />
              Auto-retesting connections in {autoRetestCountdown}s...
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-5 text-xs px-1.5 text-muted-foreground hover:text-foreground"
              onClick={() => {
                if (autoRetestTimerRef.current) clearInterval(autoRetestTimerRef.current);
                autoRetestTimerRef.current = null;
                setAutoRetestCountdown(null);
              }}
            >
              Skip
            </Button>
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-all duration-1000"
              style={{ width: `${((45 - autoRetestCountdown) / 45) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* DNS verification warning */}
      {isNotVerified && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Verify DNS records before creating mailboxes.
          </AlertDescription>
        </Alert>
      )}

      {/* Inline Add Form */}
      {showAddForm && !isNotVerified && (
        <div className="rounded-lg border border-dashed p-3 space-y-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Username</Label>
              <div className="flex items-center gap-1 mt-1">
                <Input
                  placeholder="john.smith"
                  value={newUsername}
                  onChange={(e) =>
                    setNewUsername(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ""))
                  }
                  className="h-7 text-xs flex-1"
                />
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  @{domain.domain}
                </span>
              </div>
            </div>
            <div>
              <Label className="text-xs">Display Name</Label>
              <Input
                placeholder="John Smith"
                value={newDisplayName}
                onChange={(e) => setNewDisplayName(e.target.value)}
                className="h-7 text-xs mt-1"
              />
            </div>
          </div>
          {singleDuplicate && (
            <p className="text-xs text-amber-500">
              Username &quot;{newUsername.trim().toLowerCase()}&quot; already exists on this domain.
            </p>
          )}
          <div className="flex items-center justify-between">
            {createMailbox.isPending ? (
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Loader2 className="w-3 h-3 animate-spin" />
                Creating mailbox — takes ~30s...
              </p>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => {
                  setShowAddForm(false);
                  setNewUsername("");
                  setNewDisplayName("");
                }}
              >
                Cancel
              </Button>
              <Button
                variant="cta"
                size="sm"
                className="h-7 text-xs"
                onClick={handleCreateMailbox}
                disabled={
                  !newUsername.trim() || !newDisplayName.trim() || createMailbox.isPending || singleDuplicate
                }
              >
                {createMailbox.isPending && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
                Create
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Mailbox List */}
      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading mailboxes...
        </div>
      ) : mailboxes.length === 0 ? (
        <div className="text-center py-6 rounded-lg border border-dashed text-muted-foreground text-sm">
          <Mail className="w-6 h-6 mx-auto mb-1.5 opacity-40" />
          <p>No mailboxes yet.</p>
          {!isNotVerified && (
            <Button
              variant="outline"
              size="sm"
              className="mt-2 h-7 text-xs"
              onClick={() => setShowAddForm(true)}
            >
              <Plus className="w-3 h-3 mr-1" />
              Add First Mailbox
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-1.5">
          {mailboxes.map((mailbox) => (
            <div
              key={mailbox.id}
              className="flex items-center gap-3 rounded-md border p-2"
            >
              <Popover
                open={avatarEditId === mailbox.id}
                onOpenChange={(open) => {
                  setAvatarEditId(open ? mailbox.id : null);
                  if (!open) setAvatarCustomUrl("");
                }}
              >
                <PopoverTrigger asChild>
                  <button className="flex-shrink-0 rounded-full focus:outline-none focus:ring-2 focus:ring-amber-500 relative">
                    <img
                      src={getAvatarUrl(mailbox)}
                      alt={mailbox.display_name ?? mailbox.email_address}
                      className={`w-8 h-8 rounded-full object-cover transition-opacity cursor-pointer ${
                        avatarGenCurrentId === mailbox.id || avatarGeneratingIds.has(mailbox.id)
                          ? "opacity-30"
                          : "hover:opacity-80"
                      }`}
                    />
                    {(avatarGenCurrentId === mailbox.id || avatarGeneratingIds.has(mailbox.id)) && (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <Loader2 className="w-4 h-4 animate-spin text-amber-500" />
                      </div>
                    )}
                    {avatarGenDoneIds.has(mailbox.id) && avatarGenCurrentId !== mailbox.id && (
                      <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-green-500 border-2 border-background flex items-center justify-center">
                        <svg className="w-2 h-2 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                    )}
                    {avatarGenFailedIds.has(mailbox.id) && avatarGenCurrentId !== mailbox.id && (
                      <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-red-500 border-2 border-background flex items-center justify-center">
                        <svg className="w-2 h-2 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </div>
                    )}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-56 p-3 space-y-2" align="start">
                  <img
                    src={getAvatarUrl(mailbox)}
                    alt={mailbox.display_name ?? mailbox.email_address}
                    className="w-16 h-16 rounded-full object-cover mx-auto"
                  />
                  <Button
                    variant="cta"
                    size="sm"
                    className="w-full h-7 text-xs"
                    onClick={() => handleAvatarRegenerate(mailbox)}
                    disabled={avatarGeneratingIds.has(mailbox.id)}
                  >
                    {avatarGeneratingIds.has(mailbox.id) ? (
                      <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                    ) : (
                      <Sparkles className="w-3 h-3 mr-1.5" />
                    )}
                    {avatarGeneratingIds.has(mailbox.id) ? "Generating..." : "Regenerate"}
                  </Button>
                  <div className="flex gap-1.5">
                    <Input
                      placeholder="Paste image URL"
                      value={avatarCustomUrl}
                      onChange={(e) => setAvatarCustomUrl(e.target.value)}
                      className="h-7 text-xs flex-1"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs px-2"
                      onClick={() => handleAvatarUrlSave(mailbox)}
                      disabled={!avatarCustomUrl.trim()}
                    >
                      Save
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">
                  {mailbox.display_name}
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {mailbox.email_address}
                </div>
                {(mailbox.status === "pending" || mailbox.status === "disconnected") && (
                  <div className="text-[10px] text-amber-400/80 truncate mt-0.5">
                    {getMailboxStatusReason(mailbox)}
                  </div>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 flex-shrink-0"
                onClick={() => handleAvatarRegenerate(mailbox)}
                disabled={avatarGeneratingIds.has(mailbox.id) || avatarGenCurrentId === mailbox.id}
                title="Regenerate avatar"
              >
                {avatarGeneratingIds.has(mailbox.id) ? (
                  <Loader2 className="w-3 h-3 animate-spin text-amber-500" />
                ) : (
                  <ImagePlus className="w-3 h-3" />
                )}
              </Button>
              {(mailbox.metadata as Record<string, unknown>)?.signature && (
                <Popover>
                  <PopoverTrigger asChild>
                    <button className="flex-shrink-0 focus:outline-none" title="View signature">
                      <PenLine className="w-3 h-3 text-muted-foreground hover:text-foreground transition-colors" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[560px] p-4" align="end">
                    <p className="text-xs font-medium text-muted-foreground mb-2">Signature Preview</p>
                    <div
                      className="border rounded p-4 bg-white dark:bg-zinc-900 overflow-auto max-h-64 [&_img]:!min-w-[48px] [&_img]:!min-h-[48px]"
                      dangerouslySetInnerHTML={{ __html: (mailbox.metadata as Record<string, unknown>).signature as string }}
                    />
                  </PopoverContent>
                </Popover>
              )}
              <MailboxStatusBadge status={mailbox.status} imapConnected={mailbox.imap_connected} isRetesting={retestingIds.has(mailbox.id)} />
              {mailbox.imap_connected && (
                <Wifi className="w-3 h-3 text-green-500 flex-shrink-0" />
              )}
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 flex-shrink-0"
                onClick={() =>
                  mailbox.status === 'disconnected' || !mailbox.imap_connected
                    ? handleRepair(mailbox)
                    : handleRetest(mailbox.id)
                }
                disabled={retestingIds.has(mailbox.id) || retestingAll}
                title={mailbox.status === 'disconnected' || !mailbox.imap_connected ? "Repair connection" : "Retest connection"}
              >
                {retestingIds.has(mailbox.id) ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <RefreshCw className="w-3 h-3" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 flex-shrink-0"
                onClick={() =>
                  setDeleteTarget({ id: mailbox.id, email: mailbox.email_address })
                }
                disabled={deleteMailbox.isPending}
              >
                <Trash2 className="w-3 h-3" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Bulk Add Dialog. Dialog can close while a job is running — progress
          continues in the top-of-panel banner and is durable across refreshes. */}
      <Dialog open={showBulkDialog} onOpenChange={(open) => {
        if (!open) {
          setShowBulkDialog(false);
          setGenerateError(null);
        }
      }}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Bulk Add Mailboxes</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto space-y-3 py-2 pr-1">
            {/* AI Generate section */}
            <div className="rounded-lg border border-dashed p-3 space-y-2.5">
              <p className="text-xs font-medium flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                Generate names with AI
              </p>
              {showKeyCallout && (
                <div className="flex items-start gap-2.5 rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5">
                  <KeyRound className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0 text-xs">
                    <p className="font-medium">
                      {aiKeyStatus === "invalid" ? "Your OpenRouter key isn't working" : "Connect OpenRouter to generate names"}
                    </p>
                    <p className="text-muted-foreground mt-0.5">
                      {aiKeyStatus === "invalid"
                        ? "It failed validation. Update it in Settings, then come back here."
                        : "AI names and avatars run on your own OpenRouter API key. Add it in Settings, then come back here."}
                      {" "}Or type names in the box below.
                    </p>
                  </div>
                  <Button variant="outline" size="sm" className="h-7 text-xs shrink-0" asChild>
                    <a href="/settings?tab=integrations" target="_blank" rel="noopener noreferrer">
                      {aiKeyStatus === "invalid" ? "Fix key" : "Add key"}
                      <ExternalLink className="w-3 h-3 ml-1.5" />
                    </a>
                  </Button>
                </div>
              )}
              <div className="grid grid-cols-[80px_1fr] gap-2">
                <div>
                  <Label className="text-xs">Count</Label>
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    value={generateCount}
                    onChange={(e) => setGenerateCount(Math.min(100, Math.max(1, parseInt(e.target.value) || 1)))}
                    disabled={isGenerating}
                    className="h-7 text-xs mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs">Company / Niche <span className="text-muted-foreground">(optional)</span></Label>
                  <Input
                    placeholder="e.g. B2B SaaS, real estate agency..."
                    value={generateNiche}
                    onChange={(e) => setGenerateNiche(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleGenerate(); }}
                    disabled={isGenerating}
                    className="h-7 text-xs mt-1"
                  />
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs w-full"
                onClick={handleGenerate}
                disabled={isGenerating || aiBlocked}
              >
                {isGenerating ? (
                  <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                ) : (
                  <Sparkles className="w-3 h-3 mr-1.5 text-amber-500" />
                )}
                {isGenerating ? `Generating ${generateCount} names...` : `Generate ${generateCount} names`}
              </Button>
              {generateError && (
                <p className="text-xs text-destructive flex items-start gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 mt-px shrink-0" />
                  <span>Couldn't generate names: {generateError}</span>
                </p>
              )}
            </div>

            <div>
              <Label className="text-xs text-muted-foreground">
                Mailboxes to create, one per line:{" "}
                <code className="bg-muted px-1 py-0.5 rounded">username, Display Name</code>
                {" "}@ <span className="font-mono font-medium">{domain.domain}</span>
              </Label>
              <Textarea
                className="mt-2 font-mono text-xs min-h-[200px]"
                placeholder={`john.smith, John Smith\njane.doe, Jane Doe\ninfo, Company Info`}
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
              />
              <div className="flex items-start justify-between gap-2 mt-1">
                <p className="text-xs text-muted-foreground">
                  {bulkNew.length} mailbox{bulkNew.length !== 1 ? "es" : ""} will be created.
                  {bulkDuplicates.length > 0 && (
                    <span className="text-amber-500 ml-1">
                      ({bulkDuplicates.length} duplicate{bulkDuplicates.length !== 1 ? "s" : ""} will be skipped: {bulkDuplicates.map((d) => d.username).join(", ")})
                    </span>
                  )}
                </p>
                {bulkText.trim() && !bulkProgress?.running && (
                  <button type="button" className="text-xs text-muted-foreground hover:text-foreground shrink-0" onClick={() => setBulkText("")}>
                    Clear
                  </button>
                )}
              </div>
            </div>
            {/* Options applied by the background job as each mailbox is created */}
            <div className="rounded-lg border border-dashed p-3 space-y-2.5">
              <label className={`flex items-center gap-2 ${aiBlocked ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}>
                <Checkbox
                  checked={generateAvatars && !aiBlocked}
                  disabled={aiBlocked}
                  onCheckedChange={(checked) => setGenerateAvatars(checked === true)}
                />
                <span className="text-xs font-medium flex items-center gap-1.5">
                  <ImagePlus className="w-3.5 h-3.5 text-muted-foreground" />
                  Add an AI headshot to each mailbox
                  {aiBlocked && <span className="font-normal text-muted-foreground">(needs an OpenRouter key)</span>}
                </span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={generateSignaturesOnCreate}
                  onCheckedChange={(checked) => setGenerateSignaturesOnCreate(checked === true)}
                />
                <span className="text-xs font-medium flex items-center gap-1.5">
                  <PenLine className="w-3.5 h-3.5 text-muted-foreground" />
                  Generate signatures after creation
                </span>
              </label>
              {generateSignaturesOnCreate && (
                <div className="grid grid-cols-[1fr_1fr_120px] gap-2 pl-6">
                  <div>
                    <Label className="text-xs">Company Name <span className="text-muted-foreground">(optional)</span></Label>
                    <Input
                      placeholder="Acme Corp"
                      value={sigCompanyName}
                      onChange={(e) => setSigCompanyName(e.target.value)}
                      className="h-7 text-xs mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Website <span className="text-muted-foreground">(optional)</span></Label>
                    <Input
                      placeholder="https://acme.com"
                      value={sigCompanyWebsite}
                      onChange={(e) => setSigCompanyWebsite(e.target.value)}
                      className="h-7 text-xs mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Style</Label>
                    <Select value={sigStyle} onValueChange={(v: any) => setSigStyle(v)}>
                      <SelectTrigger className="h-7 text-xs mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="professional">Professional</SelectItem>
                        <SelectItem value="modern">Modern</SelectItem>
                        <SelectItem value="minimal">Minimal</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}
            </div>

            {/* Bulk progress */}
            {(bulkProgress || sigProgress) && (
              <div className="rounded-lg border p-3 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">
                    {sigProgress ? (
                      <span className="flex items-center gap-1.5">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        {sigProgress}
                      </span>
                    ) : bulkProgress?.running ? (
                      <span className="flex items-center gap-1.5">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Creating <span className="font-mono font-medium">{bulkProgress.current}</span>...
                      </span>
                    ) : (
                      <span>Done</span>
                    )}
                  </span>
                  {bulkProgress && (
                    <span className="font-medium">
                      {bulkProgress.done}/{bulkProgress.total}
                    </span>
                  )}
                </div>
                {bulkProgress && (
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full bg-amber-500 transition-all duration-300"
                      style={{ width: `${(bulkProgress.done / bulkProgress.total) * 100}%` }}
                    />
                  </div>
                )}
                {bulkProgress?.errors && bulkProgress.errors.length > 0 && (
                  <div className="space-y-1">
                    {bulkProgress.errors.map((e) => (
                      <p key={e.username} className="text-xs text-destructive">
                        <span className="font-mono">{e.username}</span>: {e.error}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter className="flex-col sm:flex-row items-start sm:items-center gap-2">
            {!bulkProgress && bulkNew.length > 0 && (
              <p className="text-xs text-muted-foreground mr-auto">
                ~{bulkNew.length * 30}s estimated ({bulkNew.length} × ~30s per mailbox)
              </p>
            )}
            {bulkProgress?.running ? (
              <Button
                variant="destructive"
                onClick={async () => {
                  if (!trackedJobId) return;
                  setBulkStopping(true);
                  try {
                    await cancelBulkJob.mutateAsync(trackedJobId);
                  } finally {
                    setBulkStopping(false);
                  }
                }}
                disabled={bulkStopping || !trackedJobId}
              >
                <XCircle className="h-4 w-4 mr-1" />
                {bulkStopping ? "Stopping..." : "Stop"}
              </Button>
            ) : (
              <Button
                variant="outline"
                onClick={() => setShowBulkDialog(false)}
              >
                {bulkProgress ? "Close" : "Cancel"}
              </Button>
            )}
            {!bulkProgress?.running && !sigProgress && (
              <Button
                variant="cta"
                onClick={handleBulkCreate}
                disabled={bulkNew.length === 0}
              >
                Create {bulkNew.length} Mailbox{bulkNew.length !== 1 ? "es" : ""}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Mailbox</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the Exchange Online user{" "}
              <strong>{deleteTarget?.email}</strong>. All email data will be lost. This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete Mailbox
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk Signature Dialog for existing mailboxes */}
      <BulkSignatureDialog
        open={showBulkSignatureDialog}
        onOpenChange={setShowBulkSignatureDialog}
        selectedIds={mailboxes.map((m) => m.id)}
        selectedEmails={mailboxes.map((m) => m.email_address)}
        selectedMailboxes={mailboxes as unknown as EmailMailbox[]}
      />
    </div>
  );
}
