import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { AlertCircle, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { parseMessage, type Contact, type SenderAccount } from "@/lib/message-variables";
import { useCampaignPreviewLeads, type CampaignPreviewLead } from "@/hooks/useCampaignPreviewLeads";
import { useUnipileAccounts } from "@/hooks/useUnipileAccounts";
import type { SenderAccountsByChannel } from "@/hooks/useCampaigns";
import type { ChannelType } from "@/lib/sequence-utils";

interface CampaignMessagePreviewContextValue {
  leadListIds: string[];
  senderAccounts: SenderAccountsByChannel;
  channel?: ChannelType;
}

/**
 * Set by the sequence step around the node config panel. MessageEditor reads it
 * to preview against the campaign's real leads; outside a campaign it is null
 * and the editor keeps its sample-data preview.
 */
export const CampaignMessagePreviewContext = createContext<CampaignMessagePreviewContextValue | null>(null);

export function useCampaignMessagePreview() {
  return useContext(CampaignMessagePreviewContext);
}

// Mirrors the campaign-processor template context: first name falls back to
// "there", full name to "first last" or "there", location to city.
function toPreviewContact(lead: CampaignPreviewLead): Contact {
  const firstName = lead.first_name || "there";
  const fullName = `${lead.first_name || ""} ${lead.last_name || ""}`.trim() || "there";
  return {
    first_name: firstName,
    last_name: lead.last_name,
    full_name: fullName,
    job_title: lead.job_title,
    company: lead.company,
    location: lead.city,
    linkedin_bio: lead.linkedin_bio,
    home_page_text: lead.home_page_text,
    notion_preview_url: lead.notion_preview_url,
    enrichment_data: lead.enrichment_data,
    discovery_metadata: lead.discovery_metadata,
    custom_fields: lead.custom_fields,
  };
}

function leadLabel(lead: CampaignPreviewLead) {
  const name = lead.display_name && lead.display_name !== "Unknown" ? lead.display_name : null;
  return [name, lead.company].filter(Boolean).join(" · ") || lead.primary_email || "Unnamed lead";
}

interface CampaignMessagePreviewProps {
  template: string;
  customFieldDefaults: Record<string, string>;
}

export function CampaignMessagePreview({ template, customFieldDefaults }: CampaignMessagePreviewProps) {
  const ctx = useCampaignMessagePreview();
  const { data: leads, isLoading, isError, refetch } = useCampaignPreviewLeads(ctx?.leadListIds);
  const { data: unipile } = useUnipileAccounts();
  const accounts = unipile && "accounts" in unipile ? unipile.accounts : undefined;
  const [leadId, setLeadId] = useState<string | null>(null);

  useEffect(() => {
    if (leads?.length && !leads.some((l) => l.id === leadId)) setLeadId(leads[0].id);
  }, [leads, leadId]);

  const index = leads?.findIndex((l) => l.id === leadId) ?? -1;
  const lead = index >= 0 ? leads![index] : null;

  const sender = useMemo((): SenderAccount | undefined => {
    const channel = ctx?.channel;
    if (!channel || channel === "any") return undefined;
    const senderId = ctx?.senderAccounts?.[channel as keyof SenderAccountsByChannel]?.[0];
    const account = (accounts || []).find((a) => a.id === senderId);
    if (!account) return undefined;
    const name = account.display_name || "";
    return {
      account_name: name,
      first_name: account.first_name || name.split(" ")[0] || "",
      last_name: name.split(" ").slice(1).join(" "),
    };
  }, [ctx?.channel, ctx?.senderAccounts, accounts]);

  const preview = useMemo(() => {
    if (!lead) return null;
    // Custom fields with no value on this lead and no org default: the send
    // resolves them to '', so flag them instead of leaving the raw tag.
    const missing: string[] = [];
    const resolvedTemplate = template.replace(/\{\{\s*custom_(\w+)\s*\}\}/g, (match, key) => {
      const value = lead.custom_fields?.[key];
      if ((value === null || value === undefined || value === "") && !customFieldDefaults[key]) {
        missing.push(`{{custom_${key}}}`);
        return "";
      }
      return match;
    });
    if (!lead.first_name && /\{\{\s*(first_name|full_name)\s*\}\}/.test(template)) {
      missing.push("{{first_name}} (sends as “there”)");
    }
    return {
      text: parseMessage(resolvedTemplate, toPreviewContact(lead), sender, customFieldDefaults),
      missing: [...new Set(missing)],
    };
  }, [lead, template, sender, customFieldDefaults]);

  if (!ctx?.leadListIds?.length) {
    return <p className="text-[11px] text-muted-foreground">Add a lead list to the campaign to preview with real leads.</p>;
  }
  if (isLoading) {
    return (
      <p role="status" className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Loading leads…
      </p>
    );
  }
  if (isError) {
    return (
      <div role="alert" className="flex items-center gap-2 text-[11px]">
        Leads couldn’t be loaded.
        <Button variant="outline" size="sm" className="h-6 text-[11px]" onClick={() => refetch()}>
          Try again
        </Button>
      </div>
    );
  }
  if (!leads?.length) {
    return <p className="text-[11px] text-muted-foreground">The campaign’s lead lists are empty.</p>;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          aria-label="Previous lead"
          disabled={index <= 0}
          onClick={() => setLeadId(leads[index - 1].id)}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <Select value={leadId ?? undefined} onValueChange={setLeadId}>
          <SelectTrigger aria-label="Preview lead" className="h-7 min-w-0 flex-1 text-xs [&>span]:truncate">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {leads.map((l) => (
              <SelectItem key={l.id} value={l.id} className="text-xs">
                {leadLabel(l)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          aria-label="Next lead"
          disabled={index >= leads.length - 1}
          onClick={() => setLeadId(leads[index + 1].id)}
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
      <p className="text-[10px] text-muted-foreground">
        Lead {index + 1} of {leads.length}
        {lead?.primary_email ? ` · ${lead.primary_email}` : ""}
      </p>
      <p className="whitespace-pre-wrap break-words">{preview?.text}</p>
      {!!preview?.missing.length && (
        <div role="status" className="flex items-start gap-1.5 rounded border border-amber-500/30 bg-amber-500/10 p-2 text-[11px]">
          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            Missing for this lead: {preview.missing.join(", ")}
          </span>
        </div>
      )}
    </div>
  );
}
