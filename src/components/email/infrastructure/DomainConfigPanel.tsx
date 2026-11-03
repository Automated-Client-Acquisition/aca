import { useState, useEffect } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Copy, Check, Loader2, Shield, Globe, Mail, Inbox, Upload, CheckCircle2, XCircle, Trash2 } from "lucide-react";
import type { EmailSendingDomain } from "@/types/email";
import { useUpdateDomainConfig, useVerifyDns } from "@/hooks/useEmailSendingDomains";
import { useRegistrarProvider, usePushDnsToRegistrar, useUrlForwarding, useSetUrlForwarding, useDeleteUrlForwarding } from "@/hooks/useRegistrarDns";
import { DkimSection } from "./DkimSection";

interface DomainConfigPanelProps {
  domain: EmailSendingDomain;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DomainConfigPanel({ domain, open, onOpenChange }: DomainConfigPanelProps) {
  const [dmarcEmail, setDmarcEmail] = useState(domain.dmarc_email || "");
  const [forwardingEmail, setForwardingEmail] = useState(domain.forwarding_email || "");
  const [catchallEmail, setCatchallEmail] = useState(domain.catchall_email || "");
  const [catchallEnabled, setCatchallEnabled] = useState(domain.catchall_enabled);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const [forwardingUrl, setForwardingUrl] = useState("");
  const [forwardingType, setForwardingType] = useState("redirect_301");
  const [pushResults, setPushResults] = useState<{ record: { type: string; name: string }; success: boolean; error?: string }[] | null>(null);

  const [savingAction, setSavingAction] = useState<string | null>(null);
  const updateConfig = useUpdateDomainConfig();
  const verifyDns = useVerifyDns();

  const { data: registrarProvider } = useRegistrarProvider();
  const pushDns = usePushDnsToRegistrar();
  const { data: forwardingData } = useUrlForwarding(registrarProvider ? domain.domain : "");
  const setUrlForwarding = useSetUrlForwarding();
  const deleteUrlForwarding = useDeleteUrlForwarding();

  // Sync state when domain changes
  useEffect(() => {
    setDmarcEmail(domain.dmarc_email || "");
    setForwardingEmail(domain.forwarding_email || "");
    setCatchallEmail(domain.catchall_email || "");
    setCatchallEnabled(domain.catchall_enabled);
  }, [domain]);

  const handleCopy = (value: string, index: number) => {
    navigator.clipboard.writeText(value);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const handleSave = (action: "update_dmarc_email" | "update_forwarding_email" | "update_catchall") => {
    const payloads: Record<string, Record<string, unknown>> = {
      update_dmarc_email: { dmarc_email: dmarcEmail || undefined },
      update_forwarding_email: { forwarding_email: forwardingEmail || undefined },
      update_catchall: { catchall_email: catchallEmail || undefined, catchall_enabled: catchallEnabled },
    };

    setSavingAction(action);
    updateConfig.mutate(
      {
        domain_id: domain.id,
        action,
        ...payloads[action],
      } as Parameters<typeof updateConfig.mutate>[0],
      { onSettled: () => setSavingAction(null) },
    );
  };

  const isSaving = (action: string) => savingAction === action;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{domain.domain}</SheetTitle>
          <SheetDescription>
            Domain configuration and DNS authentication settings.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-6 mt-6">
          {/* Dedicated DKIM section (M365 only — renders nothing for other infra types) */}
          <DkimSection domain={domain} />

          {/* DNS Authentication — non-DKIM records */}
          <section>
            <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
              <Shield className="w-4 h-4" />
              Other DNS Records
            </h3>
            <div className="space-y-2">
              {domain.dns_records
                .filter(
                  (r) =>
                    // DKIM rendered by DkimSection; exclude here to avoid duplication (M365 only)
                    !(domain.infra_type === "m365" && r.name.toLowerCase().includes("._domainkey.")),
                )
                .map((record, i) => (
                <div key={i} className="rounded-lg border p-3 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">{record.type}</Badge>
                      <span className="text-xs font-mono truncate max-w-[200px]">{record.name}</span>
                      {record.verified ? (
                        <Badge variant="outline" className="text-xs border-green-500/30 text-green-400 bg-green-500/10">Verified</Badge>
                      ) : (
                        <Badge variant="secondary" className="text-xs">Pending</Badge>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => handleCopy(record.value, i)}
                    >
                      {copiedIndex === i ? (
                        <Check className="w-3 h-3 text-green-500" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                    </Button>
                  </div>
                  <div className="text-xs font-mono text-muted-foreground break-all bg-muted/50 rounded p-2">
                    {record.priority !== undefined && `Priority: ${record.priority} — `}
                    {record.value}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-2 mt-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => verifyDns.mutate(domain.id)}
                disabled={verifyDns.isPending}
              >
                {verifyDns.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Verify All DNS Records
              </Button>

              {registrarProvider ? (
                <Button
                  variant="cta"
                  size="sm"
                  onClick={() => {
                    setPushResults(null);
                    pushDns.mutate(
                      { domainId: domain.id },
                      {
                        onSuccess: (data) => setPushResults(data.results),
                      }
                    );
                  }}
                  disabled={pushDns.isPending}
                >
                  {pushDns.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Upload className="w-4 h-4 mr-2" />
                  )}
                  Push DNS to Porkbun
                </Button>
              ) : (
                <p className="text-xs text-muted-foreground self-center ml-1">
                  Connect a registrar in Settings &gt; API Keys to auto-push
                </p>
              )}
            </div>

            {pushResults && (
              <div className="mt-3 space-y-1">
                {pushResults.map((r, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    {r.success ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                    )}
                    <span className="font-mono">{r.record.type} {r.record.name}</span>
                    {r.error && <span className="text-red-400">— {r.error}</span>}
                  </div>
                ))}
              </div>
            )}
          </section>

          <Separator />

          {/* Domain Web Forwarding */}
          <section>
            <h3 className="text-sm font-semibold flex items-center gap-2 mb-2">
              <Globe className="w-4 h-4" />
              Domain Web Forwarding
            </h3>
            {registrarProvider ? (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Redirect {domain.domain} to your website via Porkbun.
                </p>

                {forwardingData?.forwards && forwardingData.forwards.length > 0 && (
                  <div className="space-y-1.5">
                    {forwardingData.forwards.map((f, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs bg-muted/50 rounded p-2">
                        <Globe className="w-3 h-3 text-muted-foreground shrink-0" />
                        <span className="font-mono truncate flex-1">{f.url}</span>
                        <Badge variant="outline" className="text-xs">{f.type}</Badge>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0"
                          onClick={() => deleteUrlForwarding.mutate({ domain: domain.domain })}
                          disabled={deleteUrlForwarding.isPending}
                        >
                          {deleteUrlForwarding.isPending ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Trash2 className="w-3 h-3 text-red-400" />
                          )}
                        </Button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex gap-2">
                  <Input
                    placeholder="https://yourwebsite.com"
                    value={forwardingUrl}
                    onChange={(e) => setForwardingUrl(e.target.value)}
                    className="flex-1"
                  />
                  <Select value={forwardingType} onValueChange={setForwardingType}>
                    <SelectTrigger className="w-[100px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="redirect_301">301</SelectItem>
                      <SelectItem value="redirect_302">302</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (!forwardingUrl) return;
                      setUrlForwarding.mutate(
                        {
                          domain: domain.domain,
                          url: forwardingUrl,
                          type: forwardingType,
                        },
                        {
                          onSuccess: () => setForwardingUrl(""),
                        }
                      );
                    }}
                    disabled={setUrlForwarding.isPending || !forwardingUrl}
                  >
                    {setUrlForwarding.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : setUrlForwarding.isSuccess ? (
                      <Check className="w-4 h-4 text-green-500" />
                    ) : (
                      "Save"
                    )}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Your domain registrar is not connected. To redirect <span className="font-mono font-medium text-foreground">{domain.domain}</span> to your website, add a URL redirect / forwarding rule directly in your registrar's dashboard:
                </p>
                <ol className="text-xs text-muted-foreground list-decimal list-inside space-y-1 ml-1">
                  <li>Log in to your registrar (Namecheap, GoDaddy, Cloudflare, etc.)</li>
                  <li>Find <span className="font-medium text-foreground">URL Forwarding</span>, <span className="font-medium text-foreground">Redirects</span>, or <span className="font-medium text-foreground">Page Rules</span> in your domain's DNS settings</li>
                  <li>Add a <span className="font-medium text-foreground">301 redirect</span> from <span className="font-mono">{domain.domain}</span> to your website URL</li>
                </ol>
                <p className="text-xs text-muted-foreground">
                  Alternatively, connect a Porkbun registrar key in <span className="font-medium text-foreground">Settings &gt; API Keys</span> to manage forwarding directly from here.
                </p>
              </div>
            )}
          </section>

          <Separator />

          {/* Email Forwarding */}
          <section>
            <h3 className="text-sm font-semibold flex items-center gap-2 mb-2">
              <Mail className="w-4 h-4" />
              Email Forwarding
            </h3>
            <p className="text-xs text-muted-foreground mb-2">
              Forward all incoming mail for @{domain.domain} to an external email address.
            </p>
            <div className="flex gap-2">
              <Input
                placeholder="you@company.com"
                value={forwardingEmail}
                onChange={(e) => setForwardingEmail(e.target.value)}
                className="flex-1"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleSave("update_forwarding_email")}
                disabled={!!savingAction}
              >
                {isSaving("update_forwarding_email") ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
              </Button>
            </div>
          </section>

          <Separator />

          {/* Catch-All */}
          <section>
            <h3 className="text-sm font-semibold flex items-center gap-2 mb-2">
              <Inbox className="w-4 h-4" />
              Catch-All Email
            </h3>
            <p className="text-xs text-muted-foreground mb-2">
              Receive emails sent to non-existent addresses under @{domain.domain}.
            </p>
            <div className="flex items-center gap-3 mb-2">
              <Switch
                checked={catchallEnabled}
                onCheckedChange={setCatchallEnabled}
              />
              <Label className="text-sm">
                {catchallEnabled ? "Enabled" : "Disabled"}
              </Label>
            </div>
            {catchallEnabled && (
              <div className="flex gap-2">
                <Input
                  placeholder="catchall@company.com"
                  value={catchallEmail}
                  onChange={(e) => setCatchallEmail(e.target.value)}
                  className="flex-1"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleSave("update_catchall")}
                  disabled={!!savingAction}
                >
                  {isSaving("update_catchall") ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
                </Button>
              </div>
            )}
            {!catchallEnabled && domain.catchall_enabled && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleSave("update_catchall")}
                disabled={!!savingAction}
              >
                {isSaving("update_catchall") ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Disable Catch-All
              </Button>
            )}
          </section>

          <Separator />

          {/* DMARC Report Email */}
          <section>
            <h3 className="text-sm font-semibold flex items-center gap-2 mb-2">
              <Mail className="w-4 h-4" />
              DMARC Report Email
            </h3>
            <p className="text-xs text-muted-foreground mb-2">
              Receive DMARC aggregate reports at this email address. Changes the rua= tag in the DMARC DNS record.
            </p>
            <div className="flex gap-2">
              <Input
                placeholder={`dmarc@${domain.domain}`}
                value={dmarcEmail}
                onChange={(e) => setDmarcEmail(e.target.value)}
                className="flex-1"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleSave("update_dmarc_email")}
                disabled={!!savingAction}
              >
                {isSaving("update_dmarc_email") ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
              </Button>
            </div>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
