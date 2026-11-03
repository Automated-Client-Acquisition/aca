import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

import { Label } from "@/components/ui/label";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { ContentIdea } from "@/hooks/useIdeas";
import { useBrandVoices } from "@/hooks/useBrandVoices";
import { useProducts } from "@/hooks/useProducts";
import { useBlocks } from "@/hooks/useBlocks";
import { useCompletedKnowledgeDocuments } from "@/hooks/useKnowledgeBase";
import { useAutosave } from "@/hooks/useAutosave";
import { AutosaveIndicator } from "@/components/ui/autosave-indicator";
import { IdeaWritingOptions } from "@/components/ideas/IdeaWritingOptions";
import { GenerateVariationsDialog } from "@/components/GenerateVariationsDialog";
import { IdeaTagSelector } from "@/components/ideas/IdeaTagSelector";
import { IdeaFolderSelector } from "@/components/ideas/IdeaFolderSelector";
import { useState, useEffect, useLayoutEffect, useRef, useId } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles, Mic, ShoppingBag, Compass, Wand2, Folder, BookOpen, Check, Plus, X, Zap, ExternalLink, ZapOff, MoreHorizontal } from "lucide-react";
import { IdeaGuidelinesCard, type GuidelineSourceChip } from "@/components/ideas/IdeaGuidelinesCard";
import { useIdeaGuidelinesApproval } from "@/hooks/useIdeas";
import { cleanList, guidelineSources, parseAnalysis } from "@/lib/idea-guidelines";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useBrandKit } from "@/hooks/useBrandKit";
import { useFeedOptions, useIdeaExclusions, useIdeaUsage } from "@/hooks/useIdeaFeeds";
import { AssignToAutopilotDialog } from "@/components/ideas/AssignToAutopilotDialog";
import { RemoveFromAutopilotDialog } from "@/components/ideas/RemoveFromAutopilotDialog";
import { autopilotsFedBy } from "@/lib/idea-feeds";
import { formatDate } from "@/lib/tableUtils";

function IdeaTitleInput({ value, onChange, id }: { value: string; onChange: (value: string) => void; id: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    };
    fit();
    let width = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth !== width) {
        width = el.clientWidth;
        fit();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [value]);
  return (
    <Textarea ref={ref} id={id} rows={1} value={value} onChange={(e) => onChange(e.target.value)}
      placeholder="Give your idea a title…"
      className="min-h-0 resize-none overflow-hidden border-transparent bg-transparent px-2 py-1 text-xl font-semibold leading-snug shadow-none placeholder:text-muted-foreground/50 hover:border-border focus-visible:ring-2 md:text-2xl" />
  );
}

interface IdeaDetailsDialogProps {
  idea: ContentIdea | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (id: string, updates: Partial<ContentIdea>) => void;
  isUpdating: boolean;
}

export function IdeaDetailsDialog({ idea, open, onOpenChange, onSave, isUpdating }: IdeaDetailsDialogProps) {
  const fieldId = useId();
  const { brandVoices } = useBrandVoices();
  const { products } = useProducts();
  const { blocks } = useBlocks('angle');
  const { data: knowledgeDocs = [] } = useCompletedKnowledgeDocuments();
  const queryClient = useQueryClient();
  const [editedIdea, setEditedIdea] = useState<Partial<ContentIdea>>({});
  const [variationsDialogOpen, setVariationsDialogOpen] = useState(false);
  const [isGeneratingContent, setIsGeneratingContent] = useState(false);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const approval = useIdeaGuidelinesApproval();
  const [selectedKbDocs, setSelectedKbDocs] = useState<string[]>([]);
  const [kbPopoverOpen, setKbPopoverOpen] = useState(false);
  const [additionalDirections, setAdditionalDirections] = useState("");
  const [assignOpen, setAssignOpen] = useState(false);
  const navigate = useNavigate();
  const { resolve: resolveBrandKit } = useBrandKit();
  const { data: usage } = useIdeaUsage();
  const { data: exclusions } = useIdeaExclusions();
  const [removeOpen, setRemoveOpen] = useState(false);
  const { fuel } = useFeedOptions();

  useEffect(() => {
    if (!open || !idea) {
      setEditedIdea({});
      setSelectedKbDocs([]);
      setAdditionalDirections("");
      setKbPopoverOpen(false);
    }
    // Refresh ideas data when dialog opens to pick up background enrichment results
    if (open && idea) {
      queryClient.invalidateQueries({ queryKey: ['content-ideas'] });
    }
  }, [open, idea?.id]);

  const { isSaving } = useAutosave(
    (updates) => {
      if (idea) {
        onSave(idea.id, updates);
      }
    },
    editedIdea,
    1000,
    Object.keys(editedIdea).length > 0 && !isUpdating
  );

  if (!idea) return null;

  const currentTitle = editedIdea.title ?? idea.title;
  const currentBrandVoiceId = editedIdea.brand_voice_id !== undefined ? editedIdea.brand_voice_id : idea.brand_voice_id;
  const currentProductId = editedIdea.product_id !== undefined ? editedIdea.product_id : idea.product_id;
  const currentAngleId = editedIdea.content_angle_id !== undefined ? editedIdea.content_angle_id : idea.content_angle_id;

  const baseAiAnalysis = parseAnalysis(idea.ai_analysis);

  const currentEmotionalTriggers = editedIdea.emotional_triggers ?? idea.emotional_triggers ?? [];
  const currentContentFramework = editedIdea.content_framework ?? idea.content_framework ?? "";
  const currentFreeText = editedIdea.free_text ?? idea.free_text ?? "";
  const currentSourceUrls = editedIdea.source_urls ?? idea.source_urls ?? "";

  const currentAiAnalysis = editedIdea.ai_analysis ?? baseAiAnalysis;
  const handleGenerateContent = async () => {
    if (!idea) return;
    setIsGeneratingContent(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      await supabase
        .from('content_ideas')
        .update({ generation_in_progress: true })
        .eq('id', idea.id);

      // Optimistically update the cache so the stale check uses a fresh timestamp
      queryClient.setQueriesData({ queryKey: ['content-ideas'] }, (old: any) => {
        if (!old) return old;
        return old.map((i: any) =>
          i.id === idea.id
            ? { ...i, generation_in_progress: true, updated_at: new Date().toISOString() }
            : i
        );
      });

      const body: Record<string, any> = {
        idea_id: idea.id,
        title: currentTitle,
        brand_voice_id: currentBrandVoiceId,
        product_id: currentProductId,
        content_angle_id: currentAngleId,
        ...(selectedKbDocs.length > 0 && { knowledge_document_ids: selectedKbDocs }),
        ...(additionalDirections.trim() && { additional_directions: additionalDirections.trim() }),
      };

      toast.success('Generating AI analysis...', {
        description: 'Generation will continue in the background.',
      });
      onOpenChange(false);
      setIsGeneratingContent(false);

      fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-content-idea`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        }
      ).then(async (response) => {
        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          throw new Error(err.error || `Generation failed: ${response.status}`);
        }
        const reader = response.body?.getReader();
        if (!reader) return;
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const parsed = JSON.parse(line.slice(6));
                if (parsed.type === 'error') throw new Error(parsed.error);
              } catch (_) { /* ignore parse errors for incomplete chunks */ }
            }
          }
        }
        queryClient.invalidateQueries({ queryKey: ['content-ideas'] });
      }).catch(async (err) => {
        console.error('AI generation failed:', err);
        toast.error('Generation failed', { description: err.message });
        await supabase
          .from('content_ideas')
          .update({ generation_in_progress: false })
          .eq('id', idea.id);
        queryClient.invalidateQueries({ queryKey: ['content-ideas'] });
      });

      return;
    } catch (error: any) {
      toast.error('Generation failed', { description: error.message });
      await supabase
        .from('content_ideas')
        .update({ generation_in_progress: false })
        .eq('id', idea.id);
    } finally {
      setIsGeneratingContent(false);
    }
  };

  // Suggested points are added to what's saved, so unsaved edits go first:
  // a later autosave of the old local list would drop the suggestions.
  const handleSuggestPoints = async () => {
    if (!idea) return;
    setIsSuggesting(true);
    try {
      if (Object.keys(editedIdea).length > 0) {
        const { error } = await supabase
          .from('content_ideas')
          .update(editedIdea as any)
          .eq('id', idea.id)
          .eq('organization_id', idea.organization_id);
        if (error) throw error;
        await queryClient.invalidateQueries({ queryKey: ['content-ideas'] });
        setEditedIdea({});
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-content-idea`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idea_id: idea.id,
          title: currentTitle,
          section: 'talking_points',
          brand_voice_id: currentBrandVoiceId,
          product_id: currentProductId,
          content_angle_id: currentAngleId,
          ...(selectedKbDocs.length > 0 && { knowledge_document_ids: selectedKbDocs }),
        }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `Suggestion failed: ${response.status}`);
      }
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let streamError: string | null = null;
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const parsed = JSON.parse(line.slice(6));
            if (parsed.type === 'error') streamError = parsed.error;
          } catch { /* partial chunk */ }
        }
      }
      if (streamError) throw new Error(streamError);
      await queryClient.invalidateQueries({ queryKey: ['content-ideas'] });
      toast.success('Suggested points added', { description: 'They are AI drafts: check them before approving.' });
    } catch (error: any) {
      toast.error("Couldn't suggest points", { description: error.message });
    } finally {
      setIsSuggesting(false);
    }
  };

  const handleApprove = () => {
    const reviewed = {
      ...currentAiAnalysis,
      talking_points: cleanList(currentAiAnalysis.talking_points),
      talking_points_ai: [],
      avoid: cleanList(currentAiAnalysis.avoid),
    };
    const pending = { ...editedIdea, ai_analysis: reviewed };
    // A pending autosave would otherwise write the old draft list back and
    // reset the approval (reset_idea_guidelines_approval).
    if (editedIdea.ai_analysis) setEditedIdea(pending);
    approval.mutate({ id: idea.id, approve: true, pending });
  };

  // Where a point's facts may come from: the topic, the notes, the links and the product.
  const guidelineProductId = editedIdea.product_id !== undefined ? editedIdea.product_id : idea.product_id;
  const guidelineProduct = guidelineProductId
    ? products.find((p) => p.id === guidelineProductId)
    : resolveBrandKit("product")?.element;
  const sourceLinks = currentSourceUrls.split(/\s+/).map((u) => u.trim()).filter((u) => /^https?:\/\//.test(u));
  const guidelineSourceText = guidelineSources([currentTitle, currentFreeText, currentSourceUrls, guidelineProduct as any]);
  const guidelineChips: GuidelineSourceChip[] = [
    ...sourceLinks.map((href) => {
      let label = href;
      try { label = new URL(href).hostname.replace(/^www\./, ''); } catch { /* keep the raw link */ }
      return { kind: 'link' as const, label: `Source: ${label}`, href };
    }),
    ...(guidelineProduct?.name ? [{ kind: 'product' as const, label: `Product: ${guidelineProduct.name}` }] : []),
  ];

  // Badges for header
  const badges = [
    idea.folder && { label: idea.folder.name, color: idea.folder.color, icon: Folder },
    idea.brand_voice && { label: idea.brand_voice.name, className: "bg-primary/10 border-primary/20 text-primary" },
    idea.product && { label: idea.product.name, className: "bg-blue-500/10 border-blue-500/20 text-blue-600" },
    idea.content_angle && { label: idea.content_angle.name, className: "bg-orange-500/10 border-orange-500/20 text-orange-600" },
  ].filter(Boolean);

  const ideaUsage = usage?.get(idea.id);
  const allFeeds = autopilotsFedBy((idea.tags ?? []).map((t) => t.name), fuel, exclusions?.get(idea.id));
  const source = (idea as unknown as { metadata?: { source?: string; platform?: string } | null }).metadata?.source;
  const sourceLabel =
    source === "signals" ? "From a Signal" : source === "trending" || source === "post" ? "From a post in Research" : null;
  const sourceLink = sourceLabel ? (currentSourceUrls.split("\n").find((u) => /^https?:\/\//.test(u.trim())) ?? null) : null;
  const brandKitLabel = (kind: "brand" | "product") => {
    const r = resolveBrandKit(kind);
    return r ? `Brand Kit default (${r.element.name})` : "None";
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90dvh] max-h-[900px] w-[calc(100%-1rem)] max-w-6xl flex-col gap-0 overflow-hidden p-0 [&>button]:flex [&>button]:h-8 [&>button]:w-8 [&>button]:items-center [&>button]:justify-center">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b bg-background px-5 py-4 pr-14 sm:flex-nowrap md:pl-7">
          <div className="flex min-w-0 items-center gap-4">
            <DialogHeader className="space-y-0 text-left">
              <DialogTitle className="whitespace-nowrap text-sm font-semibold">Edit idea</DialogTitle>
              <DialogDescription className="sr-only">Review guidelines and choose settings before creating content.</DialogDescription>
            </DialogHeader>
            <AutosaveIndicator isSaving={isSaving || isUpdating} className="text-xs" />
          </div>
          <div className="flex items-center gap-2">
            <Button variant="cta" size="sm" onClick={() => {
              onOpenChange(false);
              navigate(`/create?ideas=${idea.id}`);
            }} className="h-9 gap-2">
              <Sparkles className="h-4 w-4" />
              Create content
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" aria-label="More idea actions">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onSelect={() => setVariationsDialogOpen(true)}>
                  <Wand2 className="mr-2 h-4 w-4" /> Generate variations
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setAssignOpen(true)}>
                  <Zap className="mr-2 h-4 w-4" /> Use in autopilot
                </DropdownMenuItem>
                {allFeeds.length > 0 && (
                  <DropdownMenuItem onSelect={() => setRemoveOpen(true)} className="text-destructive focus:text-destructive">
                    <ZapOff className="mr-2 h-4 w-4" /> Remove from autopilot
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="px-5 py-6 md:px-7">
            <Label htmlFor={`${fieldId}-title`} className="mb-2 block text-xs font-medium text-muted-foreground">Idea title</Label>
            <div className="-mx-2">
              <IdeaTitleInput id={`${fieldId}-title`} value={currentTitle}
                onChange={(value) => setEditedIdea((prev) => ({ ...prev, title: value }))} />
            </div>

            {/* Where this idea stands: used or not, which autopilots post it, where it came from */}
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
              {ideaUsage ? (
                <span>Used {ideaUsage.used_count}×{ideaUsage.last_used_at ? `, last on ${formatDate(ideaUsage.last_used_at)}` : ""}</span>
              ) : (
                <span className="font-medium text-emerald-700 dark:text-emerald-400">New, not used yet</span>
              )}
              {sourceLabel && (
                <>
                  <span aria-hidden>·</span>
                  {sourceLink ? (
                    <a href={sourceLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-foreground">
                      {sourceLabel} <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : (
                    <span>{sourceLabel}</span>
                  )}
                </>
              )}
              {badges.length > 0 && <span aria-hidden>·</span>}
              {badges.map((b: any, i) => (
                <span
                  key={i}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-medium ${b.className || ''}`}
                  style={b.color ? { backgroundColor: `${b.color}15`, borderColor: `${b.color}30`, color: b.color } : undefined}
                >
                  {b.label}
                </span>
              ))}
            </div>

            {/* Two-column layout: Content tabs + Settings sidebar */}
            <div className="grid grid-cols-1 gap-5 mt-6 lg:grid-cols-[minmax(0,1fr)_280px] xl:grid-cols-[minmax(0,1fr)_320px]">
              {/* LEFT column: Tabbed content (2/3) */}
              <div className="min-w-0 space-y-4">
                <IdeaGuidelinesCard
                  ideaId={idea.id}
                  analysis={currentAiAnalysis}
                  onAnalysisChange={(next) => setEditedIdea((prev) => ({ ...prev, ai_analysis: next }))}
                  notes={currentFreeText}
                  onNotesChange={(value) => setEditedIdea((prev) => ({ ...prev, free_text: value }))}
                  sourceText={guidelineSourceText}
                  sourceChips={guidelineChips}
                  approvedAt={idea.guidelines_approved_at ?? null}
                  onApprove={handleApprove}
                  onUnapprove={() => approval.mutate({ id: idea.id, approve: false })}
                  isApproving={approval.isPending}
                  onSuggest={handleSuggestPoints}
                  isSuggesting={isSuggesting}
                />


              </div>

              {/* RIGHT column: Settings (1/3) */}
              <div className="min-w-0 space-y-4">
                <div className="rounded-xl border bg-muted/20 p-4 space-y-3">
                  <h3 className="text-sm font-semibold">Content settings</h3>
                  <p className="text-xs text-muted-foreground">Choose the voice, product and angle for this idea.</p>
                  <div className="space-y-2.5">
                    <Label htmlFor={`${fieldId}-voice`} className="block text-xs text-muted-foreground">Brand voice</Label>
                    <Select
                      value={currentBrandVoiceId ?? "__none__"}
                      onValueChange={(value) => setEditedIdea({ ...editedIdea, brand_voice_id: value === "__none__" ? null : value })}
                    >
                      <SelectTrigger id={`${fieldId}-voice`} className="h-9 text-sm [&>span]:min-w-0 [&>span]:truncate">
                        <SelectValue placeholder="Brand Voice" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">{brandKitLabel("brand")}</SelectItem>
                        {brandVoices.map((bv) => (
                          <SelectItem key={bv.id} value={bv.id} textValue={bv.name}>
                            <span className="flex items-center gap-1.5"><Mic className="w-3 h-3 text-primary" />{bv.name}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Label htmlFor={`${fieldId}-product`} className="block text-xs text-muted-foreground">Product</Label>
                    <Select
                      value={currentProductId ?? "__none__"}
                      onValueChange={(value) => setEditedIdea({ ...editedIdea, product_id: value === "__none__" ? null : value })}
                    >
                      <SelectTrigger id={`${fieldId}-product`} className="h-9 text-sm [&>span]:min-w-0 [&>span]:truncate">
                        <SelectValue placeholder="Product" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">{brandKitLabel("product")}</SelectItem>
                        {products.map((p) => (
                          <SelectItem key={p.id} value={p.id} textValue={p.name}>
                            <span className="flex items-center gap-1.5"><ShoppingBag className="w-3 h-3 text-blue-600" />{p.name}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Label htmlFor={`${fieldId}-angle`} className="block text-xs text-muted-foreground">Content angle</Label>
                    <Select
                      value={currentAngleId ?? "__none__"}
                      onValueChange={(value) => setEditedIdea({ ...editedIdea, content_angle_id: value === "__none__" ? null : value })}
                    >
                      <SelectTrigger id={`${fieldId}-angle`} className="h-9 text-sm [&>span]:min-w-0 [&>span]:truncate">
                        <SelectValue placeholder="Content Angle" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">No angle</SelectItem>
                        {blocks.map((block) => (
                          <SelectItem key={block.id} value={block.id} textValue={block.name || block.content}>
                            <span className="flex items-center gap-1.5"><Compass className="w-3 h-3 text-orange-600" />{block.name || block.content}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    {knowledgeDocs.length > 0 && (
                      <div className="space-y-2 border-t pt-3">
                      <p className="text-xs font-medium text-muted-foreground">Reference documents</p>
                      <p className="text-xs leading-relaxed text-muted-foreground">Choose knowledge base documents for AI suggestions in this session.</p>
                      <Popover open={kbPopoverOpen} onOpenChange={setKbPopoverOpen}>
                        <PopoverTrigger asChild>
                          <Button variant="outline" size="sm" className="h-9 w-full justify-start text-sm font-normal" aria-label="Choose reference documents">
                            <BookOpen className="w-3 h-3 mr-1.5 text-emerald-600 shrink-0" />
                            {selectedKbDocs.length === 0
                              ? "Choose documents"
                              : `${selectedKbDocs.length} doc${selectedKbDocs.length !== 1 ? 's' : ''} selected`}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[300px] max-w-[calc(100vw-2rem)] p-0" align="start"
                          onKeyDown={(event) => {
                            if (event.key === "Escape") {
                              event.preventDefault();
                              event.stopPropagation();
                              setKbPopoverOpen(false);
                            }
                          }}>
                          <Command>
                            <CommandInput placeholder="Search documents..." />
                            <CommandList>
                              <CommandEmpty>No documents found.</CommandEmpty>
                              <CommandGroup>
                                {knowledgeDocs.map((doc) => (
                                  <CommandItem
                                    key={doc.id}
                                    onSelect={() => {
                                      setSelectedKbDocs(prev =>
                                        prev.includes(doc.id)
                                          ? prev.filter(id => id !== doc.id)
                                          : [...prev, doc.id]
                                      );
                                    }}
                                  >
                                    <Check className={`w-3.5 h-3.5 mr-2 ${selectedKbDocs.includes(doc.id) ? 'opacity-100' : 'opacity-0'}`} />
                                    <span className="min-w-0 break-words text-xs">{doc.name}</span>
                                  </CommandItem>
                                ))}
                              </CommandGroup>
                            </CommandList>
                          </Command>
                        </PopoverContent>
                      </Popover>
                      {selectedKbDocs.length > 0 && (
                        <ul className="space-y-1.5">
                          {knowledgeDocs.filter((doc) => selectedKbDocs.includes(doc.id)).map((doc) => (
                            <li key={doc.id} className="flex items-start gap-2 rounded-md border bg-background py-1 pl-2 pr-1">
                              <span className="min-w-0 flex-1 break-words py-1.5 text-xs leading-relaxed">{doc.name}</span>
                              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive" aria-label={`Remove reference document ${doc.name}`}
                                onClick={() => setSelectedKbDocs((prev) => prev.filter((id) => id !== doc.id))}>
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </li>
                          ))}
                        </ul>
                      )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-xl border bg-muted/20 p-4 space-y-3">
                  <Label htmlFor={`${fieldId}-links`} className="text-sm font-semibold">Source links</Label>
                  <Textarea
                    id={`${fieldId}-links`}
                    value={currentSourceUrls}
                    onChange={(e) => setEditedIdea({ ...editedIdea, source_urls: e.target.value })}
                    className="text-sm min-h-[60px] resize-y"
                    placeholder="Paste one or more URLs, one per line..."
                  />
                  <p className="text-[11px] text-muted-foreground">Add references for the content, one URL per line.</p>
                </div>

                <div className="rounded-xl border bg-muted/20 p-4 space-y-3">
                  <h3 className="flex items-center gap-2 text-sm font-semibold"><Zap className="h-4 w-4 text-muted-foreground" /> Autopilot</h3>
                  {allFeeds.length > 0 ? (
                    <>
                      <p className="text-xs text-muted-foreground">Available to {allFeeds.length} autopilot{allFeeds.length !== 1 ? "s" : ""}.</p>
                      <ul className="space-y-2">
                        {allFeeds.map(({ fuel: feed, viaTag }) => (
                          <li key={feed.autopilot_id} className="rounded-md border bg-background px-3 py-2">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium">
                              <span className="min-w-0 break-words">{feed.name}</span>
                              {feed.status !== "active" && <span className="text-muted-foreground">{feed.status === "paused" ? "Paused" : "Inactive"}</span>}
                            </div>
                            <p className="mt-1 text-[11px] text-muted-foreground">{viaTag ? "Matches this idea’s tags" : "Accepts all ideas"}</p>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground">No autopilot currently includes this idea.</p>
                  )}
                  <Button variant="outline" size="sm" className="w-full gap-2" onClick={() => setAssignOpen(true)}>
                    <Plus className="h-3.5 w-3.5" /> Choose autopilots
                  </Button>
                </div>

                <div className="rounded-xl border bg-muted/20 p-4 space-y-3">
                  <h3 className="text-sm font-semibold">Folder and tags</h3>
                  <p className="text-[11px] text-muted-foreground">Autopilots pick ideas by tag.</p>
                  <div className="space-y-2.5">
                    <Label htmlFor={`${fieldId}-folder`} className="block text-xs text-muted-foreground">Folder</Label>
                    <IdeaFolderSelector
                      id={`${fieldId}-folder`}
                      ideaId={idea.id}
                      currentFolderId={idea.folder_id}
                      currentFolder={idea.folder}
                    />
                    <Label htmlFor={`${fieldId}-tags`} className="block text-xs text-muted-foreground">Tags</Label>
                    <IdeaTagSelector id={`${fieldId}-tags`} ideaId={idea.id} />
                  </div>
                </div>
              </div>
              <div className="min-w-0 lg:col-span-2">
                <IdeaWritingOptions
                  key={idea.id}
                  analysis={currentAiAnalysis}
                  onAnalysisChange={(next) => setEditedIdea((prev) => ({ ...prev, ai_analysis: next }))}
                  framework={currentContentFramework}
                  onFrameworkChange={(value) => setEditedIdea((prev) => ({ ...prev, content_framework: value }))}
                  triggers={currentEmotionalTriggers}
                  onTriggersChange={(values) => setEditedIdea((prev) => ({ ...prev, emotional_triggers: values }))}
                  directions={additionalDirections}
                  onDirectionsChange={setAdditionalDirections}
                  onGenerate={handleGenerateContent}
                  isGenerating={isGeneratingContent}
                  disabled={isSuggesting || approval.isPending}
                />
              </div>
            </div>
          </div>
        </ScrollArea>

        <GenerateVariationsDialog
          idea={idea}
          open={variationsDialogOpen}
          onOpenChange={setVariationsDialogOpen}
        />
        <AssignToAutopilotDialog open={assignOpen} onOpenChange={setAssignOpen} ideaIds={[idea.id]} />
        <RemoveFromAutopilotDialog open={removeOpen} onOpenChange={setRemoveOpen} ideaIds={[idea.id]} />
      </DialogContent>
    </Dialog>
  );
}
