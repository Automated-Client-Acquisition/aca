import { useId, useState } from "react";
import { ChevronDown, Loader2, Plus, Wand2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cleanList, type IdeaAnalysis } from "@/lib/idea-guidelines";

interface IdeaWritingOptionsProps {
  analysis: IdeaAnalysis;
  onAnalysisChange: (analysis: IdeaAnalysis) => void;
  framework: string;
  onFrameworkChange: (value: string) => void;
  triggers: string[];
  onTriggersChange: (values: string[]) => void;
  directions: string;
  onDirectionsChange: (value: string) => void;
  onGenerate: () => void;
  isGenerating: boolean;
  disabled: boolean;
}

const records = (value: unknown): Record<string, unknown>[] => Array.isArray(value)
  ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item)) : [];
const text = (value: unknown): string => typeof value === "string" ? value : "";
const selectChoices = (current: string, options: string[]) => options.includes(current) ? options : [current, ...options];
const optionLabel = (value: string) => value.replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase());

function EmptySection({ children }: { children: string }) {
  return <p className="rounded-lg border border-dashed bg-muted/10 px-4 py-5 text-sm leading-relaxed text-muted-foreground">{children}</p>;
}

export function IdeaWritingOptions({ analysis, onAnalysisChange, framework, onFrameworkChange, triggers, onTriggersChange, directions, onDirectionsChange, onGenerate, isGenerating, disabled }: IdeaWritingOptionsProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [newTrigger, setNewTrigger] = useState("");
  const hooks = records(analysis.hooks);
  const ctas = records(analysis.ctas);
  const busy = disabled || isGenerating;
  const updateItem = (kind: "hooks" | "ctas", index: number, field: string, value: string) => {
    const items = kind === "hooks" ? hooks : ctas;
    onAnalysisChange({ ...analysis, [kind]: items.map((item, i) => i === index ? { ...item, [field]: value } : item) });
  };
  const removeItem = (kind: "hooks" | "ctas", index: number) => {
    onAnalysisChange({ ...analysis, [kind]: (kind === "hooks" ? hooks : ctas).filter((_, i) => i !== index) });
  };
  const addTrigger = () => {
    const value = newTrigger.trim();
    if (!value || busy) return;
    if (!triggers.some((item) => item.toLowerCase() === value.toLowerCase())) onTriggersChange([...triggers, value]);
    setNewTrigger("");
  };
  const insightLists = [
    { key: "engagement_drivers", label: "Engagement drivers" },
    { key: "viral_elements", label: "Viral elements" },
    { key: "content_patterns", label: "Content patterns" },
    { key: "repurposing_ideas", label: "Repurposing ideas" },
  ].map((section) => ({ ...section, items: cleanList(analysis[section.key]) })).filter((section) => section.items.length > 0);
  const insightNotes = [
    { key: "success_factors", label: "Success factors" },
    { key: "adaptation_strategy", label: "Adaptation strategy" },
    { key: "platform_optimization", label: "Platform optimization" },
    { key: "audience_insights", label: "Audience insights" },
  ].map((section) => ({ ...section, value: text(analysis[section.key]) })).filter((section) => section.value);
  const script = records([analysis.script_structure])[0] ?? {};
  const scriptSections = ["opening", "body", "climax", "closing"].filter((key) => text(script[key]));

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="min-w-0 rounded-xl border bg-card">
      <CollapsibleTrigger className="flex w-full items-start gap-3 rounded-xl p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-5">
        <Wand2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">Writing suggestions</span>
          <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">Optional hooks, calls to action and writing direction.</span>
        </span>
        <ChevronDown className={`mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </CollapsibleTrigger>
      <CollapsibleContent className="grid grid-cols-1 items-start gap-5 border-t p-4 sm:p-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <div className="space-y-3 rounded-lg border bg-muted/20 p-3 sm:p-4">
          <div>
            <Label htmlFor={`${id}-directions`} className="text-sm font-medium">Directions for AI</Label>
            <p id={`${id}-directions-help`} className="mt-1 text-xs leading-relaxed text-muted-foreground">Describe the tone or approach. AI generates suggestions in the background.</p>
          </div>
          <Textarea id={`${id}-directions`} aria-describedby={`${id}-directions-help`} value={directions} onChange={(e) => onDirectionsChange(e.target.value)} disabled={busy} rows={3}
            className="min-h-[88px] text-sm" placeholder="e.g. Open with a practical mistake and keep the tone conversational." />
          <Button variant="outline" size="sm" onClick={onGenerate} disabled={busy} className="gap-2">
            {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
            {isGenerating ? "Generating…" : "Generate suggestions"}
          </Button>
        </div>
        <Tabs defaultValue="hooks" className="min-w-0">
          <TabsList aria-label="Writing suggestions" className="grid h-auto w-full grid-cols-2 gap-1 p-1 sm:grid-cols-5">
            <TabsTrigger value="hooks" className="min-w-0 px-2 py-2 text-xs">Opening hooks</TabsTrigger>
            <TabsTrigger value="ctas" className="min-w-0 px-2 py-2 text-xs">Calls to action</TabsTrigger>
            <TabsTrigger value="framework" className="min-w-0 px-2 py-2 text-xs">Structure</TabsTrigger>
            <TabsTrigger value="triggers" className="min-w-0 px-2 py-2 text-xs">Emotions</TabsTrigger>
            <TabsTrigger value="insights" className="col-span-2 min-w-0 px-2 py-2 text-xs sm:col-span-1">Insights</TabsTrigger>
          </TabsList>
          <TabsContent value="hooks" className="space-y-3 pt-3">
            <p className="text-xs leading-relaxed text-muted-foreground">Opening lines that give people a reason to keep reading.</p>
            {hooks.length === 0 && <EmptySection>No hooks yet. Add your own opening line or generate suggestions above.</EmptySection>}
            {hooks.map((hook, index) => (
              <div key={index} className="space-y-3 rounded-lg border p-3 sm:p-4">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor={`${id}-hook-${index}`} className="text-sm font-medium">Hook {index + 1}</Label>
                  <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" aria-label={`Remove hook ${index + 1}`} disabled={busy} onClick={() => removeItem("hooks", index)}><X className="h-4 w-4" /></Button>
                </div>
                <Textarea id={`${id}-hook-${index}`} value={text(hook.text)} onChange={(e) => updateItem("hooks", index, "text", e.target.value)} disabled={busy} className="min-h-[88px] text-sm leading-relaxed" rows={3} placeholder="Write an opening line…" />
                <div className="space-y-1.5 sm:max-w-[240px]">
                  <Label htmlFor={`${id}-hook-type-${index}`} className="text-xs text-muted-foreground">Hook style</Label>
                  <Select value={text(hook.type) || "question"} onValueChange={(v) => updateItem("hooks", index, "type", v)} disabled={busy}>
                    <SelectTrigger id={`${id}-hook-type-${index}`} className="h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>{selectChoices(text(hook.type) || "question", ["question", "statistic", "story", "bold_claim", "curiosity_gap", "contrarian", "metaphor", "pain_point"]).map((value) => <SelectItem key={value} value={value}>{optionLabel(value)}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                {text(hook.why_it_works) && <p className="border-t pt-3 text-xs leading-relaxed text-muted-foreground"><span className="font-medium">Why it works: </span>{text(hook.why_it_works)}</p>}
              </div>
            ))}
            <Button variant="outline" size="sm" className="gap-2" disabled={busy} onClick={() => onAnalysisChange({ ...analysis, hooks: [...hooks, { text: "", type: "question" }] })}><Plus className="h-4 w-4" /> Add hook</Button>
          </TabsContent>
          <TabsContent value="ctas" className="space-y-3 pt-3">
            <p className="text-xs leading-relaxed text-muted-foreground">Tell readers what to do next and where to ask.</p>
            {ctas.length === 0 && <EmptySection>No calls to action yet. Add a next step for your readers or generate suggestions above.</EmptySection>}
            {ctas.map((cta, index) => (
              <div key={index} className="space-y-3 rounded-lg border p-3 sm:p-4">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor={`${id}-cta-${index}`} className="text-sm font-medium">Call to action {index + 1}</Label>
                  <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" aria-label={`Remove call to action ${index + 1}`} disabled={busy} onClick={() => removeItem("ctas", index)}><X className="h-4 w-4" /></Button>
                </div>
                <Textarea id={`${id}-cta-${index}`} value={text(cta.text)} onChange={(e) => updateItem("ctas", index, "text", e.target.value)} disabled={busy} className="min-h-[88px] text-sm leading-relaxed" rows={3} placeholder="What should the reader do next?" />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor={`${id}-cta-type-${index}`} className="text-xs text-muted-foreground">Approach</Label>
                    <Select value={text(cta.type) || "direct"} onValueChange={(v) => updateItem("ctas", index, "type", v)} disabled={busy}>
                      <SelectTrigger id={`${id}-cta-type-${index}`} className="h-9 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>{selectChoices(text(cta.type) || "direct", ["direct", "soft", "question", "urgency", "social_proof", "value"]).map((value) => <SelectItem key={value} value={value}>{optionLabel(value)}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`${id}-cta-placement-${index}`} className="text-xs text-muted-foreground">Placement</Label>
                    <Select value={text(cta.placement) || "end"} onValueChange={(v) => updateItem("ctas", index, "placement", v)} disabled={busy}>
                      <SelectTrigger id={`${id}-cta-placement-${index}`} className="h-9 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>{selectChoices(text(cta.placement) || "end", ["end", "middle", "throughout", "opening"]).map((value) => <SelectItem key={value} value={value}>{optionLabel(value)}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
                {text(cta.effectiveness) && <p className="border-t pt-3 text-xs leading-relaxed text-muted-foreground">{text(cta.effectiveness)}</p>}
              </div>
            ))}
            <Button variant="outline" size="sm" className="gap-2" disabled={busy} onClick={() => onAnalysisChange({ ...analysis, ctas: [...ctas, { text: "", type: "direct", placement: "end" }] })}><Plus className="h-4 w-4" /> Add call to action</Button>
          </TabsContent>
          <TabsContent value="framework" className="space-y-4 pt-3">
            <div className="space-y-2">
              <Label htmlFor={`${id}-framework`}>Content structure</Label>
              <p className="text-xs text-muted-foreground">Set the order and flow of the post, from opening to conclusion.</p>
              <Textarea id={`${id}-framework`} value={framework} onChange={(e) => onFrameworkChange(e.target.value)} disabled={busy} rows={5} className="min-h-[140px] text-sm leading-relaxed" placeholder="e.g. Start with the problem, walk through the checks, then close with a practical next step." />
            </div>
            {scriptSections.length > 0 && <div className="space-y-3 rounded-lg border bg-muted/10 p-4">
              <h4 className="text-sm font-medium">Suggested script outline</h4>
              {scriptSections.map((key) => <div key={key}><h5 className="text-xs font-medium text-muted-foreground">{optionLabel(key)}</h5><p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed">{text(script[key])}</p></div>)}
            </div>}
          </TabsContent>
          <TabsContent value="triggers" className="space-y-3 pt-3">
            <p className="text-xs leading-relaxed text-muted-foreground">Choose what the reader should feel, such as curiosity, confidence or urgency.</p>
            {triggers.length === 0 && <EmptySection>No emotions set. Add one to guide the tone of the post.</EmptySection>}
            {triggers.map((trigger, index) => <div key={index} className="flex items-start gap-2 rounded-lg border p-2">
              <Textarea aria-label={`Emotion ${index + 1}`} value={trigger} onChange={(e) => onTriggersChange(triggers.map((item, i) => i === index ? e.target.value : item))} disabled={busy} rows={2} className="min-w-0 flex-1 resize-y text-sm" />
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive" aria-label={`Remove emotion ${index + 1}`} disabled={busy} onClick={() => onTriggersChange(triggers.filter((_, i) => i !== index))}><X className="h-4 w-4" /></Button>
            </div>)}
            <div className="space-y-2">
              <Label htmlFor={`${id}-new-trigger`} className="text-xs text-muted-foreground">New emotion</Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input id={`${id}-new-trigger`} value={newTrigger} onChange={(e) => setNewTrigger(e.target.value)} disabled={busy} placeholder="e.g. Curiosity" className="min-w-0 flex-1" onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); addTrigger(); } }} />
                <Button variant="cta" size="sm" className="h-10 gap-2" disabled={busy || !newTrigger.trim()} onClick={addTrigger}><Plus className="h-4 w-4" /> Add emotion</Button>
              </div>
            </div>
          </TabsContent>
          <TabsContent value="insights" className="space-y-4 pt-3">
            <p className="text-xs leading-relaxed text-muted-foreground">AI suggestions to consider when adapting and distributing this idea.</p>
            {insightLists.length === 0 && insightNotes.length === 0 && <EmptySection>No insights yet. Generate suggestions above to explore engagement, audience and repurposing ideas.</EmptySection>}
            {insightLists.map(({ key, label, items }) => <section key={key} className="space-y-3 rounded-lg border p-4"><h4 className="text-sm font-medium">{label}</h4><ul className="space-y-2 pl-4">{items.map((item, index) => <li key={index} className="list-disc whitespace-pre-wrap break-words text-sm leading-relaxed marker:text-muted-foreground">{item}</li>)}</ul></section>)}
            {insightNotes.map(({ key, label, value }) => <section key={key} className="space-y-2 rounded-lg border p-4"><h4 className="text-sm font-medium">{label}</h4><p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">{value}</p></section>)}
          </TabsContent>
        </Tabs>
      </CollapsibleContent>
    </Collapsible>
  );
}
