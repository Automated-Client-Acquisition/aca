import { useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Loader2,
  Sparkles,
  Trash2,
  Plus,
  User,
  ChevronRight,
  ChevronLeft,
  Check,
  Camera,
  ImageIcon,
  PenLine,
  FileSignature,
  Eye,
} from "lucide-react";
import { toast } from "sonner";
import type { EmailSendingDomain } from "@/types/email";
import {
  useProvisionMailboxes,
  useGenerateIdentities,
  useGenerateAvatars,
  useGenerateSignatures,
  type MailboxIdentity,
} from "@/hooks/useEmailSendingDomains";

interface ProvisionMailboxesDialogProps {
  domain: EmailSendingDomain;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type EmailPattern =
  | "firstname.lastname"
  | "f.lastname"
  | "flastname"
  | "firstname_lastname"
  | "firstnamel"
  | "firstname";

const EMAIL_PATTERNS: { value: EmailPattern; label: string; example: string }[] = [
  { value: "firstname.lastname", label: "first.last", example: "john.smith" },
  { value: "f.lastname", label: "f.last", example: "j.smith" },
  { value: "flastname", label: "flast", example: "jsmith" },
  { value: "firstname_lastname", label: "first_last", example: "john_smith" },
  { value: "firstnamel", label: "firstl", example: "johns" },
  { value: "firstname", label: "first", example: "john" },
];

function buildPreviewUsername(firstName: string, lastName: string, pattern: EmailPattern): string {
  const f = firstName.toLowerCase().replace(/[^a-z]/g, "");
  const l = lastName.toLowerCase().replace(/[^a-z]/g, "");
  if (!f || !l) return "...";
  switch (pattern) {
    case "firstname.lastname": return `${f}.${l}`;
    case "f.lastname": return `${f.charAt(0)}.${l}`;
    case "flastname": return `${f.charAt(0)}${l}`;
    case "firstname_lastname": return `${f}_${l}`;
    case "firstnamel": return `${f}${l.charAt(0)}`;
    case "firstname": return f;
    default: return `${f}.${l}`;
  }
}

type Step = "setup" | "identities" | "review";

export function ProvisionMailboxesDialog({ domain, open, onOpenChange }: ProvisionMailboxesDialogProps) {
  const [step, setStep] = useState<Step>("setup");
  const [emailPattern, setEmailPattern] = useState<EmailPattern>("firstname.lastname");

  // Setup step state
  const [count, setCount] = useState("10");
  const [companyName, setCompanyName] = useState("");
  const [companyIndustry, setCompanyIndustry] = useState("");
  const [locale, setLocale] = useState("US English — mix of diverse backgrounds");

  // Identities state
  const [identities, setIdentities] = useState<MailboxIdentity[]>([]);
  const [avatarProgress, setAvatarProgress] = useState<{ done: number; total: number } | null>(null);

  const [signatureStyle, setSignatureStyle] = useState<"professional" | "modern" | "minimal">("professional");
  const [companyWebsite, setCompanyWebsite] = useState("");
  const [enableWarmup, setEnableWarmup] = useState(false);
  const [generateAvatarsEnabled, setGenerateAvatarsEnabled] = useState(false);

  const generate = useGenerateIdentities();
  const generateAvatars = useGenerateAvatars();
  const generateSignatures = useGenerateSignatures();
  const provision = useProvisionMailboxes();

  const remaining = domain.max_mailboxes - domain.mailbox_count;
  const avatarsGenerated = identities.filter((id) => id.avatar_url).length;
  const signaturesGenerated = identities.filter((id) => id.signature_html).length;

  const handleClose = (isOpen: boolean) => {
    if (!isOpen) {
      // Reset UI state but don't kill in-flight mutations — they run to completion
      setStep("setup");
      setIdentities([]);
      setCount("10");
      setCompanyName("");
      setCompanyIndustry("");
      setAvatarProgress(null);
      setCompanyWebsite("");
      setSignatureStyle("professional");
      setEnableWarmup(false);
      setGenerateAvatarsEnabled(false);
      // Only reset idle mutations (not in-flight ones)
      if (!generate.isPending) generate.reset();
      if (!generateAvatars.isPending) generateAvatars.reset();
      if (!generateSignatures.isPending) generateSignatures.reset();
      if (!provision.isPending) provision.reset();
    }
    onOpenChange(isOpen);
  };

  // ── Kick off avatars + signatures for a set of identities ────────
  const startAvatarsAndSignatures = (newIdentities: MailboxIdentity[]) => {
    // Build indexed list of valid identities
    const valid = newIdentities
      .map((id, index) => ({ ...id, _index: index }))
      .filter((id) => id.first_name && id.last_name);

    if (valid.length === 0) return;

    // Avatars (batched, progressive) — only if enabled
    if (generateAvatarsEnabled) {
      setAvatarProgress({ done: 0, total: valid.length });
      generateAvatars.mutate({
        identities: valid.map((id) => ({
          first_name: id.first_name,
          last_name: id.last_name,
          job_title: id.job_title,
        })),
        onBatchResult: (batchAvatars, done, total) => {
          setAvatarProgress({ done, total });
          setIdentities((prev) => {
            const updated = [...prev];
            for (const avatar of batchAvatars) {
              const originalIndex = valid[avatar.index]?._index;
              if (originalIndex !== undefined && avatar.avatar_url) {
                updated[originalIndex] = { ...updated[originalIndex], avatar_url: avatar.avatar_url };
              }
            }
            return updated;
          });
        },
      });
    }

    // Signatures (single call, parallel with avatars)
    const emails = valid.map((id) =>
      `${buildPreviewUsername(id.first_name, id.last_name, emailPattern)}@${domain.domain}`
    );
    generateSignatures.mutate(
      {
        identities: valid.map((id, i) => ({
          first_name: id.first_name,
          last_name: id.last_name,
          job_title: id.job_title,
          email: emails[i],
        })),
        domain: domain.domain,
        company_name: companyName || undefined,
        company_website: companyWebsite || undefined,
        style: signatureStyle,
      },
      {
        onSuccess: (data) => {
          setIdentities((prev) => {
            const updated = [...prev];
            for (const sig of data.signatures) {
              const originalIndex = valid[sig.index]?._index;
              if (originalIndex !== undefined && sig.signature_html) {
                updated[originalIndex] = { ...updated[originalIndex], signature_html: sig.signature_html };
              }
            }
            return updated;
          });
        },
      }
    );
  };

  // ── Step 1: Setup & Generate ──────────────────────────────────────
  const handleGenerate = () => {
    const num = Math.min(parseInt(count) || 10, remaining);
    generate.mutate(
      {
        count: num,
        domain: domain.domain,
        company_name: companyName || undefined,
        company_industry: companyIndustry || undefined,
        locale: locale || undefined,
      },
      {
        onSuccess: (data) => {
          const newIdentities = data.map((d) => ({
            first_name: d.first_name,
            last_name: d.last_name,
            job_title: d.job_title,
            bio: d.bio,
          }));
          setIdentities(newIdentities);
          setStep("identities");
          // Kick off avatars + signatures in parallel
          startAvatarsAndSignatures(newIdentities);
        },
      }
    );
  };

  // ── Manual re-generation (only missing avatars) ──────────────────
  const handleGenerateAvatars = () => {
    const missing = identities
      .map((id, index) => ({ ...id, _index: index }))
      .filter((id) => id.first_name && id.last_name && !id.avatar_url);
    if (missing.length === 0) return;

    setAvatarProgress({ done: 0, total: missing.length });
    generateAvatars.mutate({
      identities: missing.map((id) => ({
        first_name: id.first_name,
        last_name: id.last_name,
        job_title: id.job_title,
      })),
      onBatchResult: (batchAvatars, done, total) => {
        setAvatarProgress({ done, total });
        setIdentities((prev) => {
          const updated = [...prev];
          for (const avatar of batchAvatars) {
            const originalIndex = missing[avatar.index]?._index;
            if (originalIndex !== undefined && avatar.avatar_url) {
              updated[originalIndex] = { ...updated[originalIndex], avatar_url: avatar.avatar_url };
            }
          }
          return updated;
        });
      },
    });
  };

  // ── Manual re-generation signatures ──────────────────────────────
  const handleGenerateSignatures = () => {
    const valid = identities
      .map((id, index) => ({ ...id, _index: index }))
      .filter((id) => id.first_name && id.last_name);
    if (valid.length === 0) return;

    generateSignatures.mutate(
      {
        identities: valid.map((id) => ({
          first_name: id.first_name,
          last_name: id.last_name,
          job_title: id.job_title,
          email: previewEmails[id._index],
        })),
        domain: domain.domain,
        company_name: companyName || undefined,
        company_website: companyWebsite || undefined,
        style: signatureStyle,
      },
      {
        onSuccess: (data) => {
          setIdentities((prev) => {
            const updated = [...prev];
            for (const sig of data.signatures) {
              const originalIndex = valid[sig.index]?._index;
              if (originalIndex !== undefined && sig.signature_html) {
                updated[originalIndex] = { ...updated[originalIndex], signature_html: sig.signature_html };
              }
            }
            return updated;
          });
        },
      }
    );
  };

  // ── Step 2: Edit identities ───────────────────────────────────────
  const updateIdentity = (index: number, field: keyof MailboxIdentity, value: string) => {
    setIdentities((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const removeIdentity = (index: number) => {
    setIdentities((prev) => prev.filter((_, i) => i !== index));
  };

  const addIdentity = () => {
    setIdentities((prev) => [
      ...prev,
      { first_name: "", last_name: "", job_title: "" },
    ]);
  };

  // ── Preview emails ────────────────────────────────────────────────
  const previewEmails = useMemo(() => {
    return identities.map((id) =>
      id.first_name && id.last_name
        ? `${buildPreviewUsername(id.first_name, id.last_name, emailPattern)}@${domain.domain}`
        : "..."
    );
  }, [identities, emailPattern, domain.domain]);

  // ── Step 3: Provision ─────────────────────────────────────────────
  const handleProvision = () => {
    const validIdentities = identities.filter((id) => id.first_name && id.last_name);
    // Fire mutation BEFORE closing — mutate must be called while hook is still mounted.
    // TanStack Query will keep the mutation running even after the component unmounts.
    provision.mutate({
      domain_id: domain.id,
      email_pattern: emailPattern,
      mailboxes: validIdentities,
      enable_warmup: enableWarmup || undefined,
    });
    toast.info(`Deploying ${validIdentities.length} mailboxes to ${domain.domain}...`);
    // Close dialog immediately — provisioning continues in background
    handleClose(false);
  };

  const validCount = identities.filter((id) => id.first_name && id.last_name).length;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-4xl max-h-[85vh] !flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>
            {step === "setup" && (domain.infra_type === "acs" ? "Create Sender Addresses" : "Deploy Mailboxes")}
            {step === "identities" && "Review Identities"}
            {step === "review" && (domain.infra_type === "acs" ? "Confirm Sender Addresses" : "Confirm Deployment")}
          </DialogTitle>
          <DialogDescription>
            {step === "setup" && `AI-generate identities, avatars & signatures for ${domain.domain}. ${remaining} slots remaining.`}
            {step === "identities" && `${identities.length} identities generated. Avatars & signatures generating in background. Edit as needed.`}
            {step === "review" && (domain.infra_type === "acs"
              ? `Register ${validCount} sender addresses on ${domain.domain}. Shared SMTP credentials will be assigned automatically.`
              : `Deploy ${validCount} mailboxes to ${domain.domain}.${enableWarmup ? " They'll start warming up automatically." : " They'll be ready to send immediately."}`)}
          </DialogDescription>
        </DialogHeader>

        {/* ── Step 1: Setup ──────────────────────────────────── */}
        {step === "setup" && (
          <ScrollArea className="flex-1 min-h-0 -mx-6 px-6">
            <div className="space-y-4 pb-1">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Number of Mailboxes</Label>
                  <Input
                    type="number"
                    min={1}
                    max={remaining}
                    value={count}
                    onChange={(e) => setCount(e.target.value)}
                    placeholder={`1-${remaining}`}
                  />
                </div>
                <div>
                  <Label>Email Pattern</Label>
                  <Select value={emailPattern} onValueChange={(v) => setEmailPattern(v as EmailPattern)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {EMAIL_PATTERNS.map((p) => (
                        <SelectItem key={p.value} value={p.value}>
                          <span>{p.label}</span>
                          <span className="text-muted-foreground ml-2">({p.example}@...)</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Separator />

              <div className="space-y-2">
                <p className="text-sm font-medium">Company Context <span className="text-muted-foreground font-normal">(helps AI generate relevant job titles)</span></p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Company Name</Label>
                    <Input
                      placeholder="Acme Corp"
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Industry</Label>
                    <Input
                      placeholder="SaaS / Marketing / Finance..."
                      value={companyIndustry}
                      onChange={(e) => setCompanyIndustry(e.target.value)}
                    />
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Name Locale / Region</Label>
                  <Input
                    placeholder="US English — mix of diverse backgrounds"
                    value={locale}
                    onChange={(e) => setLocale(e.target.value)}
                  />
                </div>
              </div>

              <Separator />

              <div className="space-y-2">
                <p className="text-sm font-medium">Signature Options <span className="text-muted-foreground font-normal">(generated alongside identities)</span></p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Style</Label>
                    <Select value={signatureStyle} onValueChange={(v) => setSignatureStyle(v as typeof signatureStyle)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="professional">Professional</SelectItem>
                        <SelectItem value="modern">Modern</SelectItem>
                        <SelectItem value="minimal">Minimal</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Company Website</Label>
                    <Input
                      placeholder="https://yourcompany.com"
                      value={companyWebsite}
                      onChange={(e) => setCompanyWebsite(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              <Separator />

              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="generate-avatars" className="text-sm font-medium">Generate AI Avatars</Label>
                  <p className="text-xs text-muted-foreground">
                    Create realistic headshot photos for each mailbox. Takes a few minutes for large batches.
                  </p>
                </div>
                <Switch
                  id="generate-avatars"
                  checked={generateAvatarsEnabled}
                  onCheckedChange={setGenerateAvatarsEnabled}
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="enable-warmup" className="text-sm font-medium">Enable Warmup Ramp</Label>
                  <p className="text-xs text-muted-foreground">
                    Start with 5 emails/day and ramp up over ~23 days. Leave off if using an external warmup tool.
                  </p>
                </div>
                <Switch
                  id="enable-warmup"
                  checked={enableWarmup}
                  onCheckedChange={setEnableWarmup}
                />
              </div>
            </div>
          </ScrollArea>
        )}

        {/* ── Step 2: Identities ─────────────────────────────── */}
        {step === "identities" && (
          <div className="flex flex-col gap-3 flex-1 min-h-0">
            {/* Generation toolbar */}
            <div className="flex items-center justify-between px-1 gap-2">
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <ImageIcon className="w-3.5 h-3.5" />
                  {avatarsGenerated > 0 ? `${avatarsGenerated}/${identities.length}` : "0"} avatars
                </span>
                <span className="flex items-center gap-1">
                  <FileSignature className="w-3.5 h-3.5" />
                  {signaturesGenerated > 0 ? `${signaturesGenerated}/${identities.length}` : "0"} signatures
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleGenerateAvatars}
                  disabled={generateAvatars.isPending || generateSignatures.isPending || validCount === 0}
                >
                  {generateAvatars.isPending ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                      {avatarProgress ? `${avatarProgress.done}/${avatarProgress.total}` : "..."}
                    </>
                  ) : (
                    <>
                      <Camera className="w-3.5 h-3.5 mr-1.5" />
                      Generate Avatars
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleGenerateSignatures}
                  disabled={generateSignatures.isPending || validCount === 0}
                >
                  {generateSignatures.isPending ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <PenLine className="w-3.5 h-3.5 mr-1.5" />
                      Redo Signatures
                    </>
                  )}
                </Button>
              </div>
            </div>

            <div className="overflow-x-auto border rounded-md">
              <ScrollArea className="max-h-[400px]">
                <table className="w-full min-w-[700px]">
                  <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm z-10">
                    <tr className="text-xs font-medium text-muted-foreground">
                      <th className="w-10 px-2 py-2" />
                      <th className="min-w-[120px] px-2 py-2 text-left">First Name</th>
                      <th className="min-w-[120px] px-2 py-2 text-left">Last Name</th>
                      <th className="min-w-[200px] px-2 py-2 text-left">Job Title</th>
                      <th className="px-2 py-2 text-left">Email Preview</th>
                      <th className="w-10 px-2 py-2 text-center">Sig.</th>
                      <th className="w-8 px-1 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {identities.map((id, i) => (
                      <tr key={i} className="border-t group hover:bg-muted/30">
                        <td className="px-2 py-1">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center shrink-0 overflow-hidden">
                                {id.avatar_url ? (
                                  <img
                                    src={id.avatar_url}
                                    alt={`${id.first_name} ${id.last_name}`}
                                    className="w-full h-full object-cover"
                                  />
                                ) : (
                                  <User className="w-3.5 h-3.5 text-muted-foreground" />
                                )}
                              </div>
                            </TooltipTrigger>
                            <TooltipContent side="right">
                              {id.avatar_url ? (
                                <img src={id.avatar_url} alt="Avatar" className="w-32 h-32 rounded-lg object-cover" />
                              ) : (
                                <p>No avatar — click "Generate AI Avatars"</p>
                              )}
                            </TooltipContent>
                          </Tooltip>
                        </td>
                        <td className="px-2 py-1">
                          <Input
                            placeholder="First name"
                            value={id.first_name}
                            onChange={(e) => updateIdentity(i, "first_name", e.target.value)}
                            className="h-7 text-sm"
                          />
                        </td>
                        <td className="px-2 py-1">
                          <Input
                            placeholder="Last name"
                            value={id.last_name}
                            onChange={(e) => updateIdentity(i, "last_name", e.target.value)}
                            className="h-7 text-sm"
                          />
                        </td>
                        <td className="px-2 py-1">
                          <Input
                            placeholder="Job title"
                            value={id.job_title || ""}
                            onChange={(e) => updateIdentity(i, "job_title", e.target.value)}
                            className="h-7 text-sm"
                          />
                        </td>
                        <td className="px-2 py-1">
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            {previewEmails[i]}
                          </span>
                        </td>
                        <td className="px-2 py-1 text-center">
                          {id.signature_html ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  className="inline-flex items-center justify-center w-6 h-6 rounded hover:bg-muted"
                                >
                                  <Eye className="w-3.5 h-3.5 text-green-500" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent side="left" className="max-w-[320px] p-0">
                                <div
                                  className="p-3 bg-white text-black text-xs overflow-auto max-h-[200px] [&_a]:text-blue-600 [&_a]:underline"
                                  dangerouslySetInnerHTML={{ __html: id.signature_html }}
                                />
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            <span className="text-muted-foreground/40">—</span>
                          )}
                        </td>
                        <td className="px-1 py-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100"
                            onClick={() => removeIdentity(i)}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollArea>
            </div>
            {identities.length < remaining && (
              <Button
                variant="outline"
                size="sm"
                onClick={addIdentity}
                className="w-full"
              >
                <Plus className="w-4 h-4 mr-2" />
                Add Identity Manually
              </Button>
            )}
          </div>
        )}

        {/* ── Step 3: Review ─────────────────────────────────── */}
        {step === "review" && (
          <>
          <div className="overflow-x-auto border rounded-md">
            <ScrollArea className="max-h-[400px]">
              <table className="w-full min-w-[650px] text-sm">
                <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm z-10">
                  <tr className="text-xs font-medium text-muted-foreground">
                    <th className="w-10 px-2 py-2" />
                    <th className="min-w-[150px] px-2 py-2 text-left">Name</th>
                    <th className="min-w-[200px] px-2 py-2 text-left">Job Title</th>
                    <th className="min-w-[220px] px-2 py-2 text-left">Email</th>
                    <th className="w-20 px-2 py-2 text-left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {identities
                    .filter((id) => id.first_name && id.last_name)
                    .map((id, i) => (
                      <tr key={i} className="border-t">
                        <td className="px-2 py-1.5">
                          <div className="w-7 h-7 rounded-full bg-muted overflow-hidden shrink-0">
                            {id.avatar_url ? (
                              <img src={id.avatar_url} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <User className="w-3.5 h-3.5 text-muted-foreground" />
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-2 py-1.5 font-medium whitespace-nowrap">
                          {id.first_name} {id.last_name}
                        </td>
                        <td className="px-2 py-1.5 text-muted-foreground whitespace-nowrap">
                          {id.job_title || "\u2014"}
                        </td>
                        <td className="px-2 py-1.5 text-muted-foreground font-mono text-xs whitespace-nowrap">
                          {buildPreviewUsername(id.first_name, id.last_name, emailPattern)}@{domain.domain}
                        </td>
                        <td className="px-2 py-1.5">
                          <Badge variant={enableWarmup ? "secondary" : "outline"} className="text-xs whitespace-nowrap">
                            {enableWarmup ? "Warming" : "Ready"}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </ScrollArea>
          </div>
          <div className="p-3 rounded-md bg-muted/50 text-sm text-muted-foreground space-y-1">
            <p>Each mailbox will:</p>
            <ul className="list-disc pl-5 space-y-0.5">
              {enableWarmup ? (
                <>
                  <li>Start with 5 emails/day and ramp up over ~23 days</li>
                  <li>Auto-promote to "ready" once warmup completes</li>
                  <li>Be available for campaigns after warmup</li>
                </>
              ) : (
                <>
                  <li>Start as "ready" with up to 60 emails/day</li>
                  <li>Be available for campaigns immediately</li>
                </>
              )}
              <li>Auto-pause if bounce rate exceeds safe thresholds</li>
              {avatarsGenerated > 0 && <li>Use AI-generated avatar as profile picture</li>}
            </ul>
          </div>
          </>
        )}

        <DialogFooter className="flex items-center justify-between sm:justify-between shrink-0">
          <div>
            {step !== "setup" && (
              <Button
                variant="outline"
                onClick={() => setStep(step === "review" ? "identities" : "setup")}
              >
                <ChevronLeft className="w-4 h-4 mr-1" />
                Back
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => handleClose(false)}>
              Cancel
            </Button>

            {step === "setup" && (
              <Button
                variant="cta"
                onClick={handleGenerate}
                disabled={generate.isPending || parseInt(count) < 1 || parseInt(count) > remaining}
              >
                {generate.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4 mr-2" />
                )}
                {generate.isPending ? "Generating..." : "Generate All"}
              </Button>
            )}

            {step === "identities" && (
              <Button
                variant="cta"
                onClick={() => setStep("review")}
                disabled={validCount === 0}
              >
                Review {validCount} Mailbox{validCount !== 1 ? "es" : ""}
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            )}

            {step === "review" && (
              <Button
                variant="cta"
                onClick={handleProvision}
                disabled={validCount === 0}
              >
                <Check className="w-4 h-4 mr-2" />
                Deploy {validCount} Mailboxes
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
