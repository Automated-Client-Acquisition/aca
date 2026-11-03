import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCreateCampaign } from "@/hooks/useCampaigns";
import { useWhatsAppTemplates } from "@/hooks/useWhatsAppTemplates";
import { useAgentProfiles } from "@/hooks/useAgentProfiles";
import { buildDbrSequence, DBR_DEFAULTS } from "@/lib/dbr-campaign-template";

const NO_TEMPLATE = "__none__";
const NO_AGENT = "__manual__";

/** Creates a draft DBR campaign (WhatsApp template → SMS → SMS) and opens it to pick the leads. */
export function DbrCampaignCard({ connected }: { connected: boolean }) {
  const navigate = useNavigate();
  const createCampaign = useCreateCampaign();
  const { data: templates = [] } = useWhatsAppTemplates();
  const usable = templates.filter((t) => ["approved", "pending", "submitted"].includes(t.approval_status));
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("Database reactivation");
  const [templateId, setTemplateId] = useState<string>(NO_TEMPLATE);
  const [firstSms, setFirstSms] = useState(DBR_DEFAULTS.firstSms);
  const [lastSms, setLastSms] = useState(DBR_DEFAULTS.lastSms);
  const { data: agents = [] } = useAgentProfiles();
  // Default agent first (the hook sorts by is_default); untouched = that agent, or manual if none
  const [agentChoice, setAgentChoice] = useState<string | null>(null);
  const agentId = agentChoice ?? agents[0]?.id ?? NO_AGENT;
  const agent = agents.find((a) => a.id === agentId);

  const create = (e: React.FormEvent) => {
    e.preventDefault();
    const template = templates.find((t) => t.id === templateId);
    const { nodes, edges } = buildDbrSequence({
      ...DBR_DEFAULTS,
      whatsappTemplateId: template?.id ?? null,
      whatsappTemplateName: template?.name ?? null,
      firstSms,
      lastSms,
      aiReplies: !!agent,
      agentProfileId: agent?.id ?? null,
    });
    createCampaign.mutate(
      {
        name: name.trim() || "Database reactivation",
        description: "Database reactivation over WhatsApp Business and SMS",
        sequence_nodes: nodes,
        sequence_edges: edges,
        stop_on_reply: true,
        agent_profile_id: agent?.id ?? null,
        campaign_type: "sms_whatsapp",
        primary_channel: "sms",
        // The template's plain nodes/edges match what the builder saves
      } as unknown as Parameters<typeof createCampaign.mutate>[0],
      {
        onSuccess: (campaign) => {
          setOpen(false);
          navigate(`/campaigns/${campaign.id}/edit`);
        },
      },
    );
  };

  return (
    <div className="rounded-xl border bg-card p-6 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-[16rem] flex-1">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Rocket className="h-5 w-5 text-muted-foreground" />
            Database reactivation
          </h3>
          <p className="text-sm text-muted-foreground">
            A ready-made automation for old leads and past customers: a WhatsApp template, then two short texts.
            A reply stops it and lands in the inbox.
          </p>
        </div>
        <Button variant="cta" className="shrink-0" onClick={() => setOpen(true)} disabled={!connected}>
          Start a DBR campaign
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <form onSubmit={create}>
            <DialogHeader>
              <DialogTitle>Database reactivation campaign</DialogTitle>
              <DialogDescription>
                Creates a draft automation. You pick the lead list next and can edit every step before starting it.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="dbr-name">Name</Label>
                <Input id="dbr-name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Step 1: WhatsApp template (optional)</Label>
                <Select value={templateId} onValueChange={setTemplateId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_TEMPLATE}>No WhatsApp step, SMS only</SelectItem>
                    {usable.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name} ({t.language}){t.approval_status === "approved" ? "" : " · in review"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Leads not on WhatsApp go straight to the texts. The first text follows {DBR_DEFAULTS.daysAfterWhatsApp} days
                  later.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="dbr-sms-1">First text</Label>
                <Textarea id="dbr-sms-1" rows={3} value={firstSms} onChange={(e) => setFirstSms(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dbr-sms-2">Last text ({DBR_DEFAULTS.daysBetweenSms} days later)</Label>
                <Textarea id="dbr-sms-2" rows={3} value={lastSms} onChange={(e) => setLastSms(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Who answers replies</Label>
                <Select value={agentId} onValueChange={setAgentChoice}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {agents.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        AI agent: {a.name}
                        {a.is_default ? " (default)" : ""}
                      </SelectItem>
                    ))}
                    <SelectItem value={NO_AGENT}>Me, from the inbox</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {agent
                    ? "The agent takes over each thread as soon as a message is sent. It drafts replies for your approval unless approval is turned off on the agent. Try it first in Settings → AI Agents."
                    : agents.length === 0
                      ? "No AI agent yet. Create one in Settings → AI Agents to have replies answered."
                      : "Replies wait in the inbox for you."}
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                Opt-out wording is added where the law requires it, and texts only go out during each contact's local
                sending hours.
              </p>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="cta" disabled={createCampaign.isPending || !firstSms.trim() || !lastSms.trim()}>
                {createCampaign.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Create and pick leads
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
