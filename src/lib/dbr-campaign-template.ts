/**
 * Database reactivation (DBR) campaign over WhatsApp Business + SMS.
 *
 *   start → WhatsApp template (optional; leads it can't reach move on)
 *         → wait → SMS opener → wait → SMS last nudge → end
 *
 * With an AI agent, a "Hand off to AI agent" step follows each send, tied to that
 * channel's thread, so the agent is already on when the lead replies (a reply stops
 * the campaign, so a handoff placed after it would never run). Handoffs continue the
 * sequence and skip quietly when the send before them was skipped.
 *
 * supabase/functions/mcp (create_dbr_campaign) and aca-cli (aca messaging dbr) keep copies.
 */

export interface DbrTemplateOptions {
  whatsappTemplateId?: string | null;
  whatsappTemplateName?: string | null;
  firstSms: string;
  lastSms: string;
  /** Days between the WhatsApp template and the first SMS */
  daysAfterWhatsApp: number;
  /** Days between the two SMS */
  daysBetweenSms: number;
  /** Turn the AI agent on for each thread (null agent = the campaign's agent) */
  aiReplies?: boolean;
  agentProfileId?: string | null;
}

export const DBR_DEFAULTS: Omit<DbrTemplateOptions, "whatsappTemplateId" | "whatsappTemplateName"> = {
  firstSms: "Hi {{first_name}}, you asked us about this a while back. Is it still something you're looking into?",
  lastSms: "Hi {{first_name}}, last message from me. Should I close your file, or is there a better time to talk?",
  daysAfterWhatsApp: 2,
  daysBetweenSms: 3,
};

interface TemplateNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

interface TemplateEdge {
  id: string;
  type: "sequenceEdge";
  source: string;
  target: string;
  sourceHandle: "default";
}

export function buildDbrSequence(opts: DbrTemplateOptions): { nodes: TemplateNode[]; edges: TemplateEdge[] } {
  const steps: Omit<TemplateNode, "position">[] = [{ id: "start", type: "start", data: {} }];
  const handoff = (id: string, channel: "whatsapp" | "sms") => {
    if (!opts.aiReplies) return;
    steps.push({
      id,
      type: "handoffToAgent",
      data: { agentProfileId: opts.agentProfileId ?? null, exitAfterHandoff: false, channel, continueOnFailure: true },
    });
  };
  if (opts.whatsappTemplateId) {
    steps.push({
      id: "dbr-whatsapp",
      type: "whatsappTemplate",
      // Leads without WhatsApp (or opted out) continue to the SMS steps
      data: { templateId: opts.whatsappTemplateId, templateName: opts.whatsappTemplateName ?? undefined, continueOnFailure: true },
    });
    handoff("dbr-ai-whatsapp", "whatsapp");
    steps.push({ id: "dbr-wait-1", type: "delay", data: { days: opts.daysAfterWhatsApp, hours: 0, minutes: 0 } });
  }
  steps.push({ id: "dbr-sms-1", type: "smsMessage", data: { message: opts.firstSms, messageVariations: [] } });
  handoff("dbr-ai-sms", "sms");
  steps.push({ id: "dbr-wait-2", type: "delay", data: { days: opts.daysBetweenSms, hours: 0, minutes: 0 } });
  steps.push({ id: "dbr-sms-2", type: "smsMessage", data: { message: opts.lastSms, messageVariations: [] } });
  steps.push({ id: "dbr-end", type: "end", data: {} });

  const nodes = steps.map((s, i) => ({ ...s, position: { x: 450, y: i * 160 } }));
  const edges = nodes.slice(1).map((n, i) => ({
    id: `edge-${nodes[i].id}-${n.id}-default`,
    type: "sequenceEdge" as const,
    source: nodes[i].id,
    target: n.id,
    sourceHandle: "default" as const,
  }));
  return { nodes, edges };
}
