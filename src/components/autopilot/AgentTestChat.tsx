import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Bot,
  Send,
  RotateCcw,
  Trash2,
  Loader2,
  User,
  ChevronRight,
  AlertTriangle,
  StopCircle,
  CheckCircle2,
  Clock,
  Megaphone,
  MinusCircle,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTestAgentProfile, type TestAgentResult } from "@/hooks/useTestAgentProfile";
import type { AgentProfile } from "@/hooks/useAgentProfiles";
import { LEAD_INTENT_LABELS, type LeadIntent } from "@/types/classification";

interface AgentTestChatProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profile: AgentProfile | null;
}

interface TestMessage {
  role: "lead" | "agent";
  content: string;
  /** The message the campaign sent first: our side, but not an agent reply */
  kind?: "campaign";
  result?: TestAgentResult;
}

const INTENT_COLORS: Record<string, string> = {
  interested: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
  meeting_booked: "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/20",
  neutral: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400 border-zinc-500/20",
  not_interested: "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/20",
  out_of_office: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/20",
  auto_reply: "bg-slate-500/15 text-slate-600 dark:text-slate-400 border-slate-500/20",
  do_not_contact: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/20",
  unsubscribe: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/20",
};

/** What production would do with the reply, in plain words. */
const DELIVERY: Record<TestAgentResult["delivery"], { label: string; icon: typeof Send; className: string }> = {
  auto_send: { label: "Would send automatically", icon: Send, className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20" },
  draft: { label: "Would wait for your approval", icon: Clock, className: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20" },
  escalated: { label: "Would hand over to you", icon: AlertTriangle, className: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20" },
  stopped: { label: "Would stop replying", icon: StopCircle, className: "bg-slate-500/10 text-slate-600 border-slate-500/20" },
  snoozed: { label: "Would follow up later", icon: Clock, className: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20" },
  no_action: { label: "Would do nothing", icon: MinusCircle, className: "bg-muted text-muted-foreground border-border/40" },
};

const CHANNELS = [
  { value: "sms", label: "SMS" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "email", label: "Email" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "instagram", label: "Instagram" },
  { value: "telegram", label: "Telegram" },
];

/** Typical lead replies to try with one click (DBR and cold outreach). */
const SAMPLE_REPLIES = [
  "Yes, still interested",
  "Who is this?",
  "How much does it cost?",
  "Not right now, maybe next month",
  "Can we talk Tuesday at 3pm?",
  "I'm out of the office until Monday",
  "Stop texting me",
];

const DEFAULT_OPENING = "Hi {{first_name}}, you asked us about this a while back. Is it still something you're looking into?";

export function AgentTestChat({ open, onOpenChange, profile }: AgentTestChatProps) {
  const [messages, setMessages] = useState<TestMessage[]>([]);
  const [input, setInput] = useState("");
  const [channel, setChannel] = useState("sms");
  const [opening, setOpening] = useState(DEFAULT_OPENING);
  const [setupOpen, setSetupOpen] = useState(true);
  const [contact, setContact] = useState({ firstName: "Marie", lastName: "", company: "Acme Corp", jobTitle: "Owner" });
  const [failedTurn, setFailedTurn] = useState<TestMessage[] | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const testAgent = useTestAgentProfile();

  // The opening message as the lead would read it
  const openingMessage = useMemo<TestMessage | null>(() => {
    const text = opening.replace(/\{\{\s*first_name\s*\}\}/gi, contact.firstName || "there").trim();
    return text ? { role: "agent", kind: "campaign", content: text } : null;
  }, [opening, contact.firstName]);

  const startAgain = useCallback(() => {
    setMessages(openingMessage ? [openingMessage] : []);
    setInput("");
    setFailedTurn(null);
    testAgent.reset();
    inputRef.current?.focus();
  }, [openingMessage, testAgent]);

  const clearAll = () => {
    setMessages([]);
    setInput("");
    setFailedTurn(null);
    testAgent.reset();
    setSetupOpen(true);
  };

  // Fresh test each time the sheet opens or the agent changes
  useEffect(() => {
    if (open) {
      setMessages(openingMessage ? [openingMessage] : []);
      setInput("");
      setFailedTurn(null);
    }
    // openingMessage is derived state; re-running on each keystroke would wipe the chat
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, profile?.id]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, testAgent.isPending]);

  const runTurn = useCallback(
    (history: TestMessage[]) => {
      if (!profile) return;
      setFailedTurn(null);
      testAgent.mutate(
        {
          agentProfileId: profile.id,
          messages: history.map((m) => ({ role: m.role, content: m.content, ...(m.kind ? { kind: m.kind } : {}) })),
          contactContext: contact,
          channel,
        },
        {
          onSuccess: (result) => {
            setMessages((prev) => [...prev, { role: "agent", content: result.reply ?? "", result }]);
          },
          onError: () => setFailedTurn(history),
        },
      );
    },
    [profile, contact, channel, testAgent],
  );

  const send = (text: string) => {
    const content = text.trim();
    if (!content || !profile || testAgent.isPending) return;
    // Starting fresh: put the opening message in first
    const base = messages.length === 0 && openingMessage ? [openingMessage] : messages;
    const history = [...base, { role: "lead" as const, content }];
    setMessages(history);
    setInput("");
    setSetupOpen(false);
    if (inputRef.current) inputRef.current.style.height = "auto";
    runTurn(history);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  };

  if (!profile) return null;

  const lastResult = [...messages].reverse().find((m) => m.result)?.result;
  const requireApproval = lastResult?.agent.require_approval ?? profile.config?.require_approval ?? true;
  const leadTurns = messages.filter((m) => m.role === "lead").length;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-xl flex flex-col p-0 gap-0">
        {/* Header */}
        <SheetHeader className="px-5 py-3.5 border-b shrink-0 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-amber-500/15 flex items-center justify-center shrink-0">
                <Bot className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              </div>
              <div className="min-w-0">
                <SheetTitle className="text-sm font-semibold truncate">Test {profile.name}</SheetTitle>
                <SheetDescription className="text-[11px]">
                  Practice conversation. Nothing is sent and nothing is saved.
                </SheetDescription>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={startAgain} disabled={testAgent.isPending}>
                <RotateCcw className="h-3.5 w-3.5 mr-1" />
                Start again
              </Button>
              <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={clearAll} disabled={testAgent.isPending}>
                <Trash2 className="h-3.5 w-3.5 mr-1" />
                Clear
              </Button>
            </div>
          </div>
          <div
            className={cn(
              "rounded-md border px-2.5 py-1.5 text-[11px]",
              requireApproval
                ? "border-amber-500/30 bg-amber-500/5 text-amber-800 dark:text-amber-300"
                : "border-emerald-500/30 bg-emerald-500/5 text-emerald-800 dark:text-emerald-300",
            )}
          >
            {requireApproval
              ? "When live, this agent drafts replies and waits for your approval in the inbox."
              : "When live, this agent sends replies on its own, without approval."}
            {lastResult && ` It has used ${lastResult.agent.replies_so_far} of its ${lastResult.agent.max_auto_replies} replies in this test.`}
          </div>
        </SheetHeader>

        {/* Scenario: who the lead is, what we sent first, which channel */}
        <Collapsible open={setupOpen} onOpenChange={setSetupOpen}>
          <CollapsibleTrigger asChild>
            <button className="w-full flex items-center gap-1.5 px-5 py-2 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors border-b">
              <ChevronRight className={cn("h-3 w-3 transition-transform", setupOpen && "rotate-90")} />
              <span>
                Scenario: <span className="text-foreground font-medium">{contact.firstName || "Lead"}</span>
                {contact.company && <span> at <span className="text-foreground font-medium">{contact.company}</span></span>}
                <span> · {CHANNELS.find((c) => c.value === channel)?.label}</span>
              </span>
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="px-5 py-3 border-b bg-muted/20 space-y-3">
              <div className="grid grid-cols-4 gap-2">
                <div>
                  <Label className="text-[10px] text-muted-foreground">Channel</Label>
                  <Select value={channel} onValueChange={setChannel}>
                    <SelectTrigger className="h-7 text-xs mt-0.5">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CHANNELS.map((ch) => (
                        <SelectItem key={ch.value} value={ch.value} className="text-xs">
                          {ch.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground">First name</Label>
                  <Input className="h-7 text-xs mt-0.5" value={contact.firstName} onChange={(e) => setContact((c) => ({ ...c, firstName: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground">Company</Label>
                  <Input className="h-7 text-xs mt-0.5" value={contact.company} onChange={(e) => setContact((c) => ({ ...c, company: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground">Job title</Label>
                  <Input className="h-7 text-xs mt-0.5" value={contact.jobTitle} onChange={(e) => setContact((c) => ({ ...c, jobTitle: e.target.value }))} />
                </div>
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground">What the campaign sent first (leave empty to start from the lead)</Label>
                <Textarea className="text-xs mt-0.5 min-h-[56px]" value={opening} onChange={(e) => setOpening(e.target.value)} />
              </div>
              <p className="text-[10px] text-muted-foreground">
                Changes apply when you click Start again.
                {lastResult?.agent.tone_profile_not_simulated && " The owner's tone profile isn't applied in tests."}
              </p>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Conversation */}
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <ScrollArea className="flex-1 min-h-0" ref={scrollRef as any}>
          <div className="px-5 py-4 space-y-3">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center text-center py-16 px-4">
                <Bot className="h-6 w-6 text-muted-foreground/40 mb-2" />
                <p className="text-sm font-medium mb-1">Reply as the lead would</p>
                <p className="text-[11px] text-muted-foreground max-w-[280px] leading-relaxed">
                  Under each answer you'll see what the agent understood and what it would do for real.
                </p>
              </div>
            )}

            {messages.map((msg, i) => {
              if (msg.kind === "campaign") {
                return (
                  <div key={i} className="flex justify-start gap-2">
                    <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center shrink-0 mt-1">
                      <Megaphone className="h-3 w-3 text-muted-foreground" />
                    </div>
                    <div className="max-w-[80%] space-y-1">
                      <div className="text-[10px] text-muted-foreground">Campaign message</div>
                      <div className="rounded-2xl rounded-bl-sm border border-dashed px-3.5 py-2 text-[13px] leading-relaxed">
                        <p className="whitespace-pre-wrap">{msg.content}</p>
                      </div>
                    </div>
                  </div>
                );
              }
              if (msg.role === "lead") {
                return (
                  <div key={i} className="flex justify-end gap-2">
                    <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-blue-600 text-white px-3.5 py-2 text-[13px] leading-relaxed">
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                    </div>
                    <div className="w-6 h-6 rounded-full bg-blue-600/10 flex items-center justify-center shrink-0 mt-1">
                      <User className="h-3 w-3 text-blue-600 dark:text-blue-400" />
                    </div>
                  </div>
                );
              }
              const r = msg.result;
              const delivery = r ? DELIVERY[r.delivery] : null;
              const DeliveryIcon = delivery?.icon ?? CheckCircle2;
              return (
                <div key={i} className="flex justify-start gap-2">
                  <div className="w-6 h-6 rounded-full bg-amber-500/15 flex items-center justify-center shrink-0 mt-1">
                    <Bot className="h-3 w-3 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div className="max-w-[85%] space-y-1.5">
                    {msg.content ? (
                      <div className="rounded-2xl rounded-bl-sm bg-muted/80 border border-border/40 px-3.5 py-2 text-[13px] leading-relaxed">
                        <p className="whitespace-pre-wrap">{msg.content}</p>
                      </div>
                    ) : (
                      <div className="text-[12px] italic text-muted-foreground">No reply written.</div>
                    )}
                    {r && delivery && (
                      <div className="rounded-lg border bg-background px-2.5 py-2 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className={cn("inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-md border", delivery.className)}>
                            <DeliveryIcon className="h-2.5 w-2.5" />
                            {delivery.label}
                          </span>
                          <span className={cn("inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded-md border", INTENT_COLORS[r.classification.intent] || INTENT_COLORS.neutral)}>
                            Read as: {LEAD_INTENT_LABELS[r.classification.intent as LeadIntent] || r.classification.intent}
                            <span className="ml-1 opacity-60">{Math.round(r.classification.confidence * 100)}%</span>
                          </span>
                        </div>
                        <p className="text-[11px] text-muted-foreground">{r.explanation}</p>
                        {r.classification.reasoning && (
                          <p className="text-[11px] text-muted-foreground/80">Why: {r.classification.reasoning}</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {testAgent.isPending && (
              <div className="flex gap-2">
                <div className="w-6 h-6 rounded-full bg-amber-500/15 flex items-center justify-center shrink-0">
                  <Bot className="h-3 w-3 text-amber-600 dark:text-amber-400" />
                </div>
                <div className="rounded-2xl rounded-bl-sm bg-muted/80 border border-border/40 px-3.5 py-2.5 text-xs text-muted-foreground flex items-center gap-1.5">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Reading the message and writing a reply…
                </div>
              </div>
            )}

            {failedTurn && !testAgent.isPending && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] text-destructive flex items-center justify-between gap-2">
                <span>{testAgent.error?.message || "The test failed."}</span>
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => runTurn(failedTurn)}>
                  <RefreshCw className="h-3 w-3 mr-1" />
                  Retry
                </Button>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Input */}
        <div className="px-4 py-3 border-t shrink-0 bg-muted/20 space-y-2">
          {leadTurns === 0 && (
            <div className="flex flex-wrap gap-1.5">
              {SAMPLE_REPLIES.map((reply) => (
                <button
                  key={reply}
                  type="button"
                  onClick={() => send(reply)}
                  disabled={testAgent.isPending}
                  className="rounded-full border bg-background px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
                >
                  {reply}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Reply as the lead…"
              rows={1}
              className={cn(
                "flex-1 resize-none rounded-lg border border-border/60 bg-background px-3 py-2 text-sm",
                "placeholder:text-muted-foreground/50",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50",
                "min-h-[38px] max-h-[100px]",
              )}
              onInput={(e) => {
                const el = e.currentTarget;
                el.style.height = "auto";
                el.style.height = Math.min(el.scrollHeight, 100) + "px";
              }}
            />
            <Button
              variant="cta"
              size="icon"
              className="h-[38px] w-[38px] rounded-lg shrink-0"
              onClick={() => send(input)}
              disabled={!input.trim() || testAgent.isPending}
              aria-label="Send as the lead"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
