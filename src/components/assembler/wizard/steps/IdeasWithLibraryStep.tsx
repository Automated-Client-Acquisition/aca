import { useState, useMemo, useRef, useEffect } from "react";
import { ManualIdeaRow } from "@/types/generation";
import { Blueprint } from "@/types/blueprint";
import { SelectedAiInsights, IdeaAiInsightsMap } from "@/types/wizard";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  Lightbulb, Plus, X, Search, Upload,
  ChevronDown, ChevronRight, Sparkles, CheckCircle2,
  FileText, ChevronLeft, ListFilter, Tag, Film,
  MonitorPlay, Globe, Link,
} from "lucide-react";
import { VideoUploadZone } from "@/components/presenter/VideoUploadZone";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { nanoid } from "nanoid";
import { useIdeas } from "@/hooks/useIdeas";
import { useIdeaTags } from "@/hooks/useIdeaTags";
import { toast } from "sonner";
import { UnifiedAIInsightsEditor } from "../UnifiedAIInsightsEditor";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface IdeasWithLibraryStepProps {
  blueprint: Blueprint;
  ideaRows: ManualIdeaRow[];
  onIdeaRowsChange: (rows: ManualIdeaRow[]) => void;
  ideaAiInsights: IdeaAiInsightsMap;
  onIdeaAiInsightsChange: (ideaId: string, insights: SelectedAiInsights | null) => void;
  /** For the unified video pipeline — the source type chosen in config step */
  videoSource?: 'url' | 'upload_video' | 'upload_images' | 'prompt_only';
}

export function IdeasWithLibraryStep({
  blueprint: _blueprint,
  ideaRows,
  onIdeaRowsChange,
  ideaAiInsights,
  onIdeaAiInsightsChange,
  videoSource,
}: IdeasWithLibraryStepProps) {
  // blueprint used for pipeline-specific rendering (e.g. video_remix)
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();
  const { ideas: dbIdeas, isLoading } = useIdeas();
  const { data: availableTags = [] } = useIdeaTags();
  const [searchQuery, setSearchQuery] = useState("");
  const [filterAiAnalysis, setFilterAiAnalysis] = useState<string>("all");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [expandedIdeas, setExpandedIdeas] = useState<Record<string, boolean>>({});
  const [manualIdeaText, setManualIdeaText] = useState("");

  // Pagination
  const ITEMS_PER_PAGE = 10;
  const [currentPage, setCurrentPage] = useState(1);

  // Separate selected and available ideas
  const selectedIdeaIds = new Set(ideaRows.map(row => row.id));

  // Extract unique filter options from DB ideas
  const { uniqueProducts, uniqueBrands, uniqueAngles } = useMemo(() => {
    if (!dbIdeas) return { uniqueProducts: [], uniqueBrands: [], uniqueAngles: [] };

    const products = new Map();
    const brands = new Map();
    const angles = new Map();

    dbIdeas.forEach(idea => {
      if (idea.product) products.set(idea.product.id, idea.product.name);
      if (idea.brand_voice) brands.set(idea.brand_voice.id, idea.brand_voice.name);
      if (idea.content_angle) angles.set(idea.content_angle.id, idea.content_angle.name);
    });

    return {
      uniqueProducts: Array.from(products.entries()).map(([id, name]) => ({ id, name })),
      uniqueBrands: Array.from(brands.entries()).map(([id, name]) => ({ id, name })),
      uniqueAngles: Array.from(angles.entries()).map(([id, name]) => ({ id, name }))
    };
  }, [dbIdeas]);

  const [filterProduct, setFilterProduct] = useState("all");
  const [filterBrand, setFilterBrand] = useState("all");
  const [filterAngle, setFilterAngle] = useState("all");

  const activeFilterCount = [
    filterAiAnalysis !== "all",
    filterProduct !== "all",
    filterBrand !== "all",
    filterAngle !== "all",
    selectedTags.length > 0
  ].filter(Boolean).length;

  // Check if any filters are active
  const hasActiveFilters = searchQuery.trim() !== "" || activeFilterCount > 0;

  // Clear all filters
  const clearFilters = () => {
    setSearchQuery("");
    setFilterAiAnalysis("all");
    setFilterProduct("all");
    setFilterBrand("all");
    setFilterAngle("all");
    setSelectedTags([]);
  };

  // Toggle tag selection
  const toggleTag = (tagName: string) => {
    setSelectedTags(prev =>
      prev.includes(tagName)
        ? prev.filter(t => t !== tagName)
        : [...prev, tagName]
    );
  };

  const filteredDbIdeas = useMemo(() => {
    if (!dbIdeas) return [];

    return dbIdeas.filter(idea => {
      // Text search
      const query = searchQuery.toLowerCase().trim();
      if (query && !idea.title.toLowerCase().includes(query)) {
        return false;
      }

      // AI analysis filter
      if (filterAiAnalysis !== "all") {
        const hasAi = !!idea.ai_analysis;
        if (filterAiAnalysis === "with" && !hasAi) return false;
        if (filterAiAnalysis === "without" && hasAi) return false;
      }

      // Product Filter
      if (filterProduct !== "all") {
        if (idea.product?.id !== filterProduct) return false;
      }

      // Brand Filter
      if (filterBrand !== "all") {
        if (idea.brand_voice?.id !== filterBrand) return false;
      }

      // Angle Filter
      if (filterAngle !== "all") {
        if (idea.content_angle?.id !== filterAngle) return false;
      }

      // Tag Filter (AND logic - idea must have ALL selected tags)
      if (selectedTags.length > 0) {
        const ideaTagNames = idea.tags?.map((t: { name: string }) => t.name) || [];
        if (!selectedTags.every(tag => ideaTagNames.includes(tag))) {
          return false;
        }
      }

      return true;
    });
  }, [dbIdeas, searchQuery, filterAiAnalysis, filterProduct, filterBrand, filterAngle, selectedTags]);

  // Split into selected and available
  const selectedIdeas = filteredDbIdeas.filter(idea => selectedIdeaIds.has(idea.id));
  const availableIdeas = filteredDbIdeas.filter(idea => !selectedIdeaIds.has(idea.id));

  // Calculate pagination
  const totalPages = Math.ceil(availableIdeas.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const paginatedIdeas = availableIdeas.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  // Reset pagination when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, filterAiAnalysis, filterProduct, filterBrand, filterAngle, selectedTags]);

  // Manual ideas (not in DB)
  const manualIdeas = ideaRows.filter(row => !dbIdeas?.find(idea => idea.id === row.id));

  // Idea management functions
  // ... (rest of functions unchanged until render) ...
  const addManualIdea = () => {
    if (!manualIdeaText.trim()) return;
    const newId = nanoid();
    onIdeaRowsChange([...ideaRows, { id: newId, context: manualIdeaText.trim() }]);
    setExpandedIdeas(prev => ({ ...prev, [newId]: true }));
    setManualIdeaText("");
    toast.success("Manual idea added");
  };

  const updateIdea = (id: string, field: string, value: string) => {
    onIdeaRowsChange(ideaRows.map(row => row.id === id ? { ...row, [field]: value } : row));
  };

  const toggleIdeaSelection = (idea: { id: string; title: string }, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const exists = ideaRows.some(row => row.id === idea.id);
    if (exists) {
      onIdeaRowsChange(ideaRows.filter(row => row.id !== idea.id));
      // Collapse when deselected
      setExpandedIdeas(prev => {
        const newState = { ...prev };
        delete newState[idea.id];
        return newState;
      });
    } else {
      const fullIdea = dbIdeas.find(i => i.id === idea.id);
      onIdeaRowsChange([...ideaRows, {
        id: idea.id,
        context: idea.title,
        ...(fullIdea?.free_text ? { freeText: fullIdea.free_text } : {}),
        ...(fullIdea?.source_urls ? { sourceUrls: fullIdea.source_urls } : {}),
      }]);

      // Preselect first hook, talking points and first CTA if idea has AI analysis
      const aiAnalysis = getIdeaAiAnalysis(idea.id);
      if (aiAnalysis) {
        const hooks = aiAnalysis.hooks || [];
        const talkingPoints = aiAnalysis.talking_points || [];
        const ctas = aiAnalysis.ctas || [];
        const hasHooks = hooks.length > 0;
        const hasTalkingPoints = talkingPoints.length > 0;
        const hasCtas = ctas.length > 0;

        if (hasHooks || hasTalkingPoints || hasCtas) {
          onIdeaAiInsightsChange(idea.id, {
            createVariations: hasHooks,
            selectedHookIndices: hasHooks ? [0] : [],
            hookMode: 'combine',
            createTalkingPointVariations: hasTalkingPoints,
            selectedTalkingPointIndices: hasTalkingPoints
              ? talkingPoints.map((_: any, i: number) => i)
              : [],
            talkingPointMode: 'combine',
            includeTalkingPoints: false,
            includeCta: hasCtas,
            selectedCtaIndex: hasCtas ? 0 : null,
            selectedCtaIndices: hasCtas ? [0] : [],
            ctaMode: 'combine',
            includeScriptStructure: false,
            includeEngagementDrivers: false,
          });
        }
      }
    }
  };

  const removeManualIdea = (id: string) => {
    onIdeaRowsChange(ideaRows.filter(row => row.id !== id));
    setExpandedIdeas(prev => {
      const newState = { ...prev };
      delete newState[id];
      return newState;
    });
  };

  const toggleExpand = (id: string) => {
    setExpandedIdeas(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = event => {
      const text = event.target?.result as string;
      const lines = text.split('\n').map(line => line.trim()).filter(line => line);
      const startIndex = lines[0]?.toLowerCase().includes('idea') || lines[0]?.toLowerCase().includes('title') ? 1 : 0;
      const newIdeas = lines.slice(startIndex).map(line => ({
        id: nanoid(),
        context: line.split(',')[0].trim()
      }));
      if (newIdeas.length > 0) {
        onIdeaRowsChange([...ideaRows, ...newIdeas]);
        toast.success(`Imported ${newIdeas.length} idea${newIdeas.length !== 1 ? 's' : ''} from CSV`);
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Save a manual idea to the database (called before AI generation)
  const saveManualIdeaToDb = async (row: ManualIdeaRow): Promise<string> => {
    // Use currentOrganization from AuthContext - it already respects impersonation
    if (!currentOrganization) throw new Error('No organization context');

    const { data, error } = await supabase
      .from('content_ideas')
      .insert({
        title: row.context,
        organization_id: currentOrganization.id,
        generation_in_progress: true,
      })
      .select()
      .single();

    if (error) throw error;

    const oldId = row.id;
    const newId = data.id;

    // Update ideaRows to use the new DB ID
    onIdeaRowsChange(
      ideaRows.map(r => r.id === oldId ? { ...r, id: newId } : r)
    );

    // Transfer expanded state to new ID
    setExpandedIdeas(prev => {
      const newState = { ...prev };
      if (newState[oldId]) {
        newState[newId] = newState[oldId];
        delete newState[oldId];
      }
      return newState;
    });

    // Transfer AI insights to new ID
    const existingInsights = ideaAiInsights[oldId];
    if (existingInsights) {
      onIdeaAiInsightsChange(newId, existingInsights);
    }

    toast.success('Idea saved to bank');
    return newId;
  };

  // Get AI analysis for each idea
  const getIdeaAiAnalysis = (ideaId: string) => {
    const dbIdea = dbIdeas?.find(idea => idea.id === ideaId);
    if (!dbIdea) return null;

    const baseAnalysis = typeof dbIdea?.ai_analysis === 'string'
      ? JSON.parse(dbIdea.ai_analysis)
      : (dbIdea?.ai_analysis || {});

    return { ...baseAnalysis };
  };

  // Get badge counts for an idea
  const getInsightCounts = (ideaId: string) => {
    const aiAnalysis = getIdeaAiAnalysis(ideaId);
    const insights = ideaAiInsights[ideaId];

    const hooks = aiAnalysis?.hooks?.length || 0;
    const talkingPoints = aiAnalysis?.talking_points?.length || 0;
    const ctas = aiAnalysis?.ctas?.length || 0;

    // Count selected items
    const selectedHooks = insights?.selectedHookIndices?.length || 0;
    const selectedTPs = insights?.selectedTalkingPointIndices?.length || 0;
    const selectedCTAs = insights?.selectedCtaIndices?.length || 0;

    return { hooks, talkingPoints, ctas, selectedHooks, selectedTPs, selectedCTAs };
  };

  // Calculate estimated versions based on selection modes
  const getEstimatedVersionCount = (ideaId: string) => {
    const insights = ideaAiInsights[ideaId] || {} as any; // Cast to avoid strict type checks on partial defaults

    const hookVariationsCount = insights.createVariations && insights.hookMode === "separate"
      ? Math.max(1, (insights.selectedHookIndices || []).length)
      : 1;

    const talkingPointVariationsCount =
      insights.createTalkingPointVariations && insights.talkingPointMode === "separate"
        ? Math.max(1, (insights.selectedTalkingPointIndices || []).length)
        : 1;

    const ctaVariationsCount =
      insights.includeCta && insights.ctaMode === "separate"
        ? Math.max(1, (insights.selectedCtaIndices || []).length)
        : 1;

    return hookVariationsCount * talkingPointVariationsCount * ctaVariationsCount;
  };

  // Render an idea card (used for both selected and available)
  const renderIdeaCard = (idea: { id: string; title: string; ai_analysis?: any; keywords?: string[]; free_text?: string | null; source_urls?: string | null }, isSelected: boolean) => {
    const isExpanded = expandedIdeas[idea.id] ?? false;
    const hasAiAnalysis = !!idea.ai_analysis;
    const hasFreeText = !!(idea.free_text || ideaRows.find(r => r.id === idea.id)?.freeText);
    const hasUrls = !!(idea.source_urls || ideaRows.find(r => r.id === idea.id)?.sourceUrls);
    const currentInsights = ideaAiInsights[idea.id] || null;
    const aiAnalysis = getIdeaAiAnalysis(idea.id);
    const counts = getInsightCounts(idea.id);

    return (
      <Card
        key={idea.id}
        className={cn(
          "transition-all overflow-hidden",
          isSelected && "ring-2 ring-amber-500 bg-amber-500/5",
          !isSelected && "hover:bg-accent/30"
        )}
      >
        <Collapsible
          open={isExpanded}
          onOpenChange={() => toggleExpand(idea.id)}
        >
          <div className="flex items-center gap-3 p-4">
            {/* Checkbox */}
            <Checkbox
              checked={isSelected}
              onClick={(e) => toggleIdeaSelection(idea, e)}
              className="shrink-0 h-5 w-5 rounded-md data-[state=checked]:bg-amber-500 data-[state=checked]:border-amber-500"
            />

            {/* Main content - clickable to expand */}
            <CollapsibleTrigger asChild>
              <div className="flex-1 min-w-0 cursor-pointer overflow-hidden">
                <div className="flex items-center gap-2 mb-1">
                  <TooltipProvider delayDuration={300}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className={cn(
                          "font-medium truncate text-base",
                          isSelected ? "text-amber-700 dark:text-amber-400" : "text-foreground"
                        )}>
                          {idea.title}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-md">
                        <p className="whitespace-normal">{idea.title}</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  {hasAiAnalysis && (
                    <Sparkles className="h-3.5 w-3.5 text-primary shrink-0" />
                  )}
                </div>

                {/* Badges row */}
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Show counts when collapsed and has AI analysis */}
                  {!isExpanded && hasAiAnalysis && (
                    <>
                      {counts.hooks > 0 && (
                        <Badge variant="secondary" className="text-xs px-1.5 h-5">
                          {isSelected ? `${counts.selectedHooks}/` : ''}{counts.hooks} hooks
                        </Badge>
                      )}
                      {counts.talkingPoints > 0 && (
                        <Badge variant="secondary" className="text-xs px-1.5 h-5">
                          {isSelected ? `${counts.selectedTPs}/` : ''}{counts.talkingPoints} TPs
                        </Badge>
                      )}
                      {counts.ctas > 0 && (
                        <Badge variant="secondary" className="text-xs px-1.5 h-5">
                          {isSelected ? `${counts.selectedCTAs}/` : ''}{counts.ctas} CTAs
                        </Badge>
                      )}
                      {isSelected && (
                        <Badge variant="default" className="text-xs px-1.5 h-5 bg-blue-600 hover:bg-blue-700 ml-1">
                          {getEstimatedVersionCount(idea.id)} version{getEstimatedVersionCount(idea.id) !== 1 ? 's' : ''}
                        </Badge>
                      )}
                    </>
                  )}
                  {/* Show keywords when no AI analysis */}
                  {!isExpanded && !hasAiAnalysis && idea.keywords && idea.keywords.length > 0 && (
                    idea.keywords.slice(0, 3).map(kw => (
                      <Badge key={kw} variant="outline" className="text-xs px-1.5 h-5 text-muted-foreground">{kw}</Badge>
                    ))
                  )}
                  {/* Free text / URL indicators */}
                  {!isExpanded && hasFreeText && (
                    <Badge variant="outline" className="text-xs px-1.5 h-5 text-muted-foreground gap-1">
                      <FileText className="h-3 w-3" />Text
                    </Badge>
                  )}
                  {!isExpanded && hasUrls && (
                    <Badge variant="outline" className="text-xs px-1.5 h-5 text-muted-foreground gap-1">
                      <Link className="h-3 w-3" />URLs
                    </Badge>
                  )}
                </div>
              </div>
            </CollapsibleTrigger>

            {/* Expand chevron */}
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="icon" className="shrink-0 h-8 w-8 text-muted-foreground hover:text-foreground">
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </Button>
            </CollapsibleTrigger>
          </div>

          {/* Expanded content */}
          <CollapsibleContent>
            <CardContent className="pt-0 pb-4 border-t bg-muted/20">
              {/* Free text + URLs — compact overrides */}
              {isSelected && (
                <div className="space-y-2 pt-3 pb-1 px-2">
                  <Textarea
                    placeholder="Add custom text or notes..."
                    value={ideaRows.find(r => r.id === idea.id)?.freeText ?? idea.free_text ?? ''}
                    onChange={e => updateIdea(idea.id, 'freeText', e.target.value)}
                    rows={3}
                    className="resize-none text-sm bg-background"
                  />
                  <Textarea
                    placeholder="Reference URLs, one per line..."
                    value={ideaRows.find(r => r.id === idea.id)?.sourceUrls ?? idea.source_urls ?? ''}
                    onChange={e => updateIdea(idea.id, 'sourceUrls', e.target.value)}
                    rows={2}
                    className="resize-none text-sm bg-background"
                  />
                </div>
              )}
              <UnifiedAIInsightsEditor
                ideaId={idea.id}
                ideaTitle={idea.title}
                ideaContext={idea.title}
                aiAnalysis={aiAnalysis || {}}
                keyTalkingPoints={undefined}
                selectedInsights={currentInsights}
                onInsightsChange={(insights) => onIdeaAiInsightsChange(idea.id, insights)}
                onAnalysisUpdated={() => {
                  queryClient.invalidateQueries({ queryKey: ['content-ideas'] });
                }}
              />
            </CardContent>
          </CollapsibleContent>
        </Collapsible >
      </Card >
    );
  };

  // Render manual idea card
  const renderManualIdeaCard = (row: ManualIdeaRow) => {
    const isExpanded = expandedIdeas[row.id] ?? false;
    // Try to get AI analysis from DB if this idea was recently saved
    const dbIdea = dbIdeas?.find(i => i.id === row.id);
    const aiAnalysis = dbIdea ? getIdeaAiAnalysis(row.id) : {};
    const keyTalkingPoints: string[] = [];

    return (
      <Card
        key={row.id}
        className="ring-2 ring-primary bg-primary/5 transition-all"
      >
        <Collapsible
          open={isExpanded}
          onOpenChange={() => toggleExpand(row.id)}
        >
          <div className="flex items-center gap-3 p-4">
            {/* Manual icon */}
            <div className="h-8 w-8 shrink-0 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
              <Lightbulb className="h-4 w-4 text-amber-500" />
            </div>

            {/* Main content */}
            <CollapsibleTrigger asChild>
              <div className="flex-1 min-w-0 cursor-pointer">
                <div className="flex items-center gap-2 mb-1">
                  <TooltipProvider delayDuration={300}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="font-medium truncate text-base text-primary">
                          {row.context || 'New Manual Idea'}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-md">
                        <p className="whitespace-normal">{row.context || 'New Manual Idea'}</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs border-amber-200 text-amber-600 dark:border-amber-800 dark:text-amber-400">Manual Entry</Badge>
                </div>
              </div>
            </CollapsibleTrigger>

            {/* Remove button */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => removeManualIdea(row.id)}
              className="shrink-0 h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
            >
              <X className="h-4 w-4" />
            </Button>

            {/* Expand chevron */}
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="icon" className="shrink-0 h-8 w-8 text-muted-foreground hover:text-foreground">
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </Button>
            </CollapsibleTrigger>
          </div>

          {/* Expanded content */}
          <CollapsibleContent>
            <CardContent className="pt-0 pb-4 border-t bg-muted/20">
              <div className="space-y-4 pt-4">
                {/* Editable title/context */}
                <div className="space-y-1.5 px-2">
                  <label className="text-sm font-medium">Idea Title</label>
                  <Textarea
                    placeholder="Describe your content idea..."
                    value={row.context}
                    onChange={e => updateIdea(row.id, 'context', e.target.value)}
                    rows={2}
                    className="resize-none bg-background"
                  />
                </div>

                {/* Free text + URLs */}
                <div className="space-y-2 px-2">
                  <Textarea
                    placeholder="Add custom text or notes..."
                    value={row.freeText || ''}
                    onChange={e => updateIdea(row.id, 'freeText', e.target.value)}
                    rows={3}
                    className="resize-none text-sm bg-background"
                  />
                  <Textarea
                    placeholder="Reference URLs, one per line..."
                    value={row.sourceUrls || ''}
                    onChange={e => updateIdea(row.id, 'sourceUrls', e.target.value)}
                    rows={2}
                    className="resize-none text-sm bg-background"
                  />
                </div>

                {/* AI Insights Editor - same as DB ideas */}
                <UnifiedAIInsightsEditor
                  ideaId={row.id}
                  ideaTitle={row.context}
                  ideaContext={row.context}
                  aiAnalysis={aiAnalysis || {}}
                  keyTalkingPoints={keyTalkingPoints}
                  selectedInsights={ideaAiInsights[row.id] || null}
                  onInsightsChange={(insights) => onIdeaAiInsightsChange(row.id, insights)}
                  onBeforeGenerate={async () => {
                    // Check if this is still a manual idea (not yet in DB)
                    const isManualId = !dbIdeas?.find(i => i.id === row.id);
                    if (isManualId) {
                      const newId = await saveManualIdeaToDb(row);
                      return newId;
                    }
                    return null;
                  }}
                  onAnalysisUpdated={() => {
                    queryClient.invalidateQueries({ queryKey: ['content-ideas'] });
                  }}
                />
              </div>
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>
    );
  };

  // ── Video pipelines: Source Pages variant ─────────────────────────────
  // For unified video: only url/upload_video need the source-card UI; prompt_only/upload_images use standard ideas flow
  const isPresenterVideo = _blueprint?.pipeline === 'presenter_video' ||
    (_blueprint?.pipeline === 'video' && (videoSource === 'url' || videoSource === 'upload_video'));

  // Map unified video source to row sourceType
  const isUnifiedVideo = _blueprint?.pipeline === 'video';
  const unifiedSourceType: 'url' | 'upload' | 'prompt_only' =
    videoSource === 'upload_video' ? 'upload'
    : videoSource === 'upload_images' ? 'prompt_only'
    : videoSource === 'prompt_only' ? 'prompt_only'
    : 'url';

  const addPresenterSource = () => {
    const newId = nanoid();
    const defaultSourceType = isUnifiedVideo ? unifiedSourceType : 'url';
    onIdeaRowsChange([...ideaRows, { id: newId, context: '', sourceType: defaultSourceType, sourceUrl: '' }]);
  };

  const updateSourceType = (id: string, type: 'url' | 'upload' | 'prompt_only') => {
    onIdeaRowsChange(ideaRows.map(row => row.id === id ? { ...row, sourceType: type } : row));
  };

  const updateSourceUrl = (id: string, url: string) => {
    onIdeaRowsChange(ideaRows.map(row => row.id === id ? { ...row, sourceUrl: url } : row));
  };

  if (isPresenterVideo) {
    const headerTitle = isUnifiedVideo
      ? videoSource === 'url' ? 'Source Pages' : videoSource === 'upload_video' ? 'Source Videos' : 'Content Ideas'
      : 'Source Pages';
    const headerDescription = isUnifiedVideo
      ? videoSource === 'url' ? 'Add the web pages you want to turn into videos. Each source becomes a separate output.'
        : videoSource === 'upload_video' ? 'Upload the videos you want to remix. Each video becomes a separate output.'
        : 'Add your content ideas. Each idea becomes a separate video.'
      : 'Add the web pages or videos you want to present. Each source becomes a separate output.';
    const HeaderIcon = isUnifiedVideo && videoSource === 'upload_video' ? Film : isUnifiedVideo && videoSource !== 'url' ? Lightbulb : MonitorPlay;

    return (
      <div className="space-y-8 animate-fade-in">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3 mb-2">
            <HeaderIcon className="h-8 w-8 text-cta" />
            {headerTitle}
          </h1>
          <p className="text-muted-foreground text-lg">
            {headerDescription}
          </p>
        </div>

        {/* Source Cards */}
        <div className="space-y-4">
          {ideaRows.map((row, index) => {
            // Unified video: source type locked from config; presenter: per-row
            const sourceType = isUnifiedVideo ? unifiedSourceType : (row.sourceType || 'url');
            return (
              <Card key={row.id} className="border-cta/20">
                <CardContent className="p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="h-7 w-7 rounded-full bg-cta/10 flex items-center justify-center text-sm font-semibold text-cta">
                        {index + 1}
                      </div>
                      <span className="font-medium text-sm">{isUnifiedVideo ? (videoSource === 'url' ? 'Page' : videoSource === 'upload_video' ? 'Video' : 'Idea') : 'Source'} {index + 1}</span>
                    </div>
                    {ideaRows.length > 1 && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeManualIdea(row.id)}
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>

                  {/* Source type selector — only for presenter_video (unified video locks source from config) */}
                  {!isUnifiedVideo && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => updateSourceType(row.id, 'url')}
                      className={cn(
                        'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all',
                        sourceType === 'url'
                          ? 'border-cta bg-cta/10 text-cta'
                          : 'border-border text-muted-foreground hover:border-cta/50',
                      )}
                    >
                      <Globe className="h-3 w-3" />
                      URL
                    </button>
                    <button
                      type="button"
                      onClick={() => updateSourceType(row.id, 'upload')}
                      className={cn(
                        'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all',
                        sourceType === 'upload'
                          ? 'border-cta bg-cta/10 text-cta'
                          : 'border-border text-muted-foreground hover:border-cta/50',
                      )}
                    >
                      <Upload className="h-3 w-3" />
                      Upload Video
                    </button>
                    <button
                      type="button"
                      onClick={() => updateSourceType(row.id, 'prompt_only')}
                      className={cn(
                        'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all',
                        sourceType === 'prompt_only'
                          ? 'border-cta bg-cta/10 text-cta'
                          : 'border-border text-muted-foreground hover:border-cta/50',
                      )}
                    >
                      <FileText className="h-3 w-3" />
                      Prompt Only
                    </button>
                  </div>
                  )}

                  {/* Conditional input based on source type */}
                  {sourceType === 'url' && (
                    <Input
                      placeholder="https://example.com/product-page"
                      value={row.sourceUrl || ''}
                      onChange={(e) => updateSourceUrl(row.id, e.target.value)}
                      className="focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  )}

                  {sourceType === 'upload' && (
                    <VideoUploadZone
                      value={row.uploadedVideoUrl}
                      onChange={(url) => onIdeaRowsChange(ideaRows.map(r => r.id === row.id ? { ...r, uploadedVideoUrl: url } : r))}
                    />
                  )}

                  {sourceType === 'prompt_only' && (
                    <div className="space-y-1.5">
                      <Textarea
                        placeholder="Describe what the video should cover (min 20 characters)..."
                        value={row.context}
                        onChange={(e) => updateIdea(row.id, 'context', e.target.value)}
                        rows={3}
                        className="resize-none text-sm"
                      />
                      {row.context.trim().length > 0 && row.context.trim().length < 20 && (
                        <p className="text-xs text-amber-500">
                          Minimum 20 characters ({row.context.trim().length}/20)
                        </p>
                      )}
                    </div>
                  )}

                  {/* Brief / context — always shown */}
                  {sourceType !== 'prompt_only' && (
                    <div className="space-y-1.5">
                      <label className="text-xs text-muted-foreground">
                        Additional context (optional)
                      </label>
                      <Textarea
                        placeholder="Focus on pricing section, highlight key features..."
                        value={row.context}
                        onChange={(e) => updateIdea(row.id, 'context', e.target.value)}
                        rows={2}
                        className="resize-none text-sm"
                      />
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Add another source */}
        <Button
          variant="outline"
          onClick={addPresenterSource}
          className="w-full border-dashed border-cta/30 hover:border-cta/50 hover:bg-cta/5"
        >
          <Plus className="h-4 w-4 mr-2" />
          Add Another Source
        </Button>
      </div>
    );
  }

  // ── Video Remix: Source Videos variant ──────────────────────────────────
  const isVideoRemix = _blueprint?.pipeline === 'video_remix';

  const addVideoIdea = () => {
    const newId = nanoid();
    onIdeaRowsChange([...ideaRows, { id: newId, context: '', uploadedVideoUrl: undefined }]);
  };

  const updateVideoUrl = (id: string, url: string | undefined) => {
    onIdeaRowsChange(ideaRows.map(row => row.id === id ? { ...row, uploadedVideoUrl: url } : row));
  };

  if (isVideoRemix) {
    return (
      <div className="space-y-8 animate-fade-in">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3 mb-2">
            <Film className="h-8 w-8 text-cta" />
            Source Videos
          </h1>
          <p className="text-muted-foreground text-lg">
            Upload the videos you want to remix. Each video becomes a separate output.
          </p>
        </div>

        {/* Video Upload Cards */}
        <div className="space-y-4">
          {ideaRows.map((row, index) => (
            <Card key={row.id} className="border-cta/20">
              <CardContent className="p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="h-7 w-7 rounded-full bg-cta/10 flex items-center justify-center text-sm font-semibold text-cta">
                      {index + 1}
                    </div>
                    <span className="font-medium text-sm">
                      {row.uploadedVideoUrl ? 'Video uploaded' : 'Upload a video'}
                    </span>
                  </div>
                  {ideaRows.length > 1 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeManualIdea(row.id)}
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>

                <VideoUploadZone
                  value={row.uploadedVideoUrl}
                  onChange={(url) => updateVideoUrl(row.id, url)}
                />

                {/* Optional context note */}
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">
                    Additional context (optional)
                  </label>
                  <Textarea
                    placeholder="e.g., Focus on the pricing comparison section, emphasize our advantages..."
                    value={row.context}
                    onChange={e => updateIdea(row.id, 'context', e.target.value)}
                    rows={2}
                    className="resize-none text-sm"
                  />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Add another video */}
        <Button
          variant="outline"
          onClick={addVideoIdea}
          className="w-full border-dashed border-cta/30 hover:border-cta/50 hover:bg-cta/5"
        >
          <Plus className="h-4 w-4 mr-2" />
          Add Another Video
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col md:flex-row gap-8 items-start">
        <div className="flex-1 min-w-0">
          <h1 className="text-3xl font-bold flex items-center gap-3 mb-2">
            <Lightbulb className="h-8 w-8 text-primary" />
            Content Ideas
          </h1>
          <p className="text-muted-foreground text-lg">
            Add manual ideas or select from your Idea Bank. Configure AI breakdown for each idea.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Manual Entry & Selected List */}
        <div className="lg:col-span-7 space-y-6">
          {/* Add Manual Idea Section - Enhanced */}
          <Card className="border-primary/20 shadow-sm bg-gradient-to-br from-card to-primary/5">
            <CardContent className="p-5 space-y-4">
              <div className="flex items-center gap-2 mb-1">
                <div className="p-2 bg-primary/10 rounded-lg">
                  <Plus className="h-4 w-4 text-primary" />
                </div>
                <h3 className="font-semibold text-lg">Add Manual Idea</h3>
              </div>

              <div className="flex gap-3">
                <div className="flex-1 space-y-2">
                  <Input
                    placeholder="Type your idea title or topic..."
                    value={manualIdeaText}
                    onChange={e => setManualIdeaText(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && manualIdeaText.trim()) {
                        addManualIdea();
                      }
                    }}
                    className="h-11 border-primary/20 focus-visible:ring-primary/20"
                  />
                </div>
                <Button
                  variant="cta"
                  onClick={addManualIdea}
                  disabled={!manualIdeaText.trim()}
                  size="lg"
                  className="h-11 px-6 font-semibold shadow-sm"
                >
                  Add
                </Button>
              </div>

              <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
                <div className="flex items-center gap-2">
                  <FileText className="h-3.5 w-3.5" />
                  <span>You can edit the details after adding</span>
                </div>

                <div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv"
                    onChange={handleCsvUpload}
                    className="hidden"
                  />
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-muted-foreground hover:text-primary"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="h-3 w-3 mr-1.5" />
                    Import from CSV
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Selected Ideas List */}
          {(selectedIdeas.length > 0 || manualIdeas.length > 0) ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between px-1">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                  Selected Ideas
                  <Badge variant="secondary" className="ml-1 px-2">{selectedIdeas.length + manualIdeas.length}</Badge>
                </h2>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onIdeaRowsChange([])}
                  className="text-muted-foreground hover:text-destructive"
                >
                  Clear All
                </Button>
              </div>

              <div className="space-y-3">
                {/* Manual ideas first */}
                {manualIdeas.map(row => renderManualIdeaCard(row))}

                {/* Selected DB ideas */}
                {selectedIdeas.map(idea => renderIdeaCard(idea, true))}
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed p-8 text-center bg-muted/30">
              <Lightbulb className="h-10 w-10 mx-auto mb-3 text-muted-foreground opacity-50" />
              <h3 className="font-medium mb-1">No ideas selected</h3>
              <p className="text-sm text-muted-foreground">
                Add a manual idea above or select from the Idea Bank on the right.
              </p>
            </div>
          )}
        </div>

        {/* Right Column: Idea Bank */}
        <div className="lg:col-span-5 space-y-4 h-full flex flex-col min-w-0">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Idea Bank
              <Badge variant="outline" className="ml-1">{availableIdeas.length}</Badge>
            </h2>
          </div>

          {/* Filter Bar - Redesigned */}
          <div className="space-y-2 mb-2 p-1">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search ideas..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="pl-9 h-10"
                />
              </div>
              <Button
                variant={showFilters || activeFilterCount > 0 ? "secondary" : "outline"}
                size="icon"
                className="h-10 w-10 shrink-0"
                onClick={() => setShowFilters(!showFilters)}
              >
                <div className="relative">
                  <ListFilter className="h-4 w-4" />
                  {activeFilterCount > 0 && (
                    <span className="absolute -top-2 -right-2 h-3.5 w-3.5 rounded-full bg-primary text-[9px] text-primary-foreground flex items-center justify-center border border-background">
                      {activeFilterCount}
                    </span>
                  )}
                </div>
              </Button>
              {hasActiveFilters && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={clearFilters}
                  title="Clear all filters"
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>

            <Collapsible open={showFilters} onOpenChange={setShowFilters}>
              <CollapsibleContent className="space-y-3 animate-fade-in-down">
                <div className="grid grid-cols-2 gap-2 p-3 bg-muted/30 rounded-lg border">
                  {/* AI Status Filter */}
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider px-1">AI Analysis</label>
                    <Select value={filterAiAnalysis} onValueChange={setFilterAiAnalysis}>
                      <SelectTrigger className="h-8 text-xs bg-background">
                        <SelectValue placeholder="Any Status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Any Status</SelectItem>
                        <SelectItem value="with">With AI</SelectItem>
                        <SelectItem value="without">No AI</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Product Filter */}
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider px-1">Product</label>
                    <Select value={filterProduct} onValueChange={setFilterProduct}>
                      <SelectTrigger className="h-8 text-xs bg-background">
                        <SelectValue placeholder="All Products" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Products</SelectItem>
                        {uniqueProducts.map(p => (
                          <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Brand Filter */}
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider px-1">Brand Voice</label>
                    <Select value={filterBrand} onValueChange={setFilterBrand}>
                      <SelectTrigger className="h-8 text-xs bg-background">
                        <SelectValue placeholder="All Brands" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Brands</SelectItem>
                        {uniqueBrands.map(b => (
                          <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Angle Filter */}
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider px-1">Angle</label>
                    <Select value={filterAngle} onValueChange={setFilterAngle}>
                      <SelectTrigger className="h-8 text-xs bg-background">
                        <SelectValue placeholder="All Angles" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Angles</SelectItem>
                        {uniqueAngles.map(a => (
                          <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Tag Filter - Full width with scrollable container */}
                  {availableTags.length > 0 && (
                    <div className="col-span-2 space-y-1.5 pt-1 border-t mt-2">
                      <div className="flex items-center justify-between pt-2">
                        <label className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider px-1">
                          Tags {selectedTags.length > 0 && `(${selectedTags.length} selected)`}
                        </label>
                        {selectedTags.length > 0 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-5 px-2 text-[10px] text-muted-foreground hover:text-destructive"
                            onClick={() => setSelectedTags([])}
                          >
                            Clear tags
                          </Button>
                        )}
                      </div>
                      {/* Selected tags displayed prominently */}
                      {selectedTags.length > 0 && (
                        <div className="flex flex-wrap gap-1 pb-1.5">
                          {selectedTags.map(tagName => (
                            <Badge
                              key={tagName}
                              variant="default"
                              className="cursor-pointer text-xs px-2 py-0.5 bg-primary hover:bg-primary/80"
                              onClick={() => toggleTag(tagName)}
                            >
                              <Tag className="h-2.5 w-2.5 mr-1" />
                              {tagName}
                              <X className="h-2.5 w-2.5 ml-1" />
                            </Badge>
                          ))}
                        </div>
                      )}
                      {/* Scrollable tag container */}
                      <div className="max-h-24 overflow-y-auto rounded border bg-background/50 p-2">
                        <div className="flex flex-wrap gap-1">
                          {availableTags
                            .filter(tag => !selectedTags.includes(tag.name))
                            .map(tag => (
                              <Badge
                                key={tag.id}
                                variant="outline"
                                className="cursor-pointer text-xs px-2 py-0.5 transition-colors hover:bg-accent hover:border-primary/50"
                                onClick={() => toggleTag(tag.name)}
                              >
                                <Tag className="h-2.5 w-2.5 mr-1 text-muted-foreground" />
                                {tag.name}
                              </Badge>
                            ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>

          <ScrollArea className="h-[calc(100vh-380px)] min-h-[400px] rounded-xl border bg-background/50 shadow-sm w-full flex-1 [&>[data-radix-scroll-area-viewport]]:!overflow-x-hidden">
            <div className="p-3 pr-4 grid grid-cols-1 gap-2">
              {isLoading ? (
                <div className="text-center py-12 text-muted-foreground">
                  <div className="h-6 w-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                  Loading ideas...
                </div>
              ) : paginatedIdeas.length > 0 ? (
                paginatedIdeas.map(idea => renderIdeaCard(idea, false))
              ) : (
                <div className="text-center py-12 px-4 text-muted-foreground">
                  <p className="mb-2">No ideas found in bank</p>
                  {hasActiveFilters && (
                    <Button variant="link" onClick={clearFilters} className="h-auto p-0 text-primary">
                      Clear filters
                    </Button>
                  )}
                </div>
              )}
            </div>
          </ScrollArea>

          {/* Pagination Controls - Fixed at bottom */}
          {!isLoading && totalPages > 1 && (
            <div className="flex items-center justify-between pt-2 px-1 border-t mt-auto">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="h-8 px-2 text-muted-foreground"
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Prev
              </Button>
              <span className="text-xs text-muted-foreground font-medium">
                Page {currentPage} of {totalPages}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="h-8 px-2 text-muted-foreground"
              >
                Next
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>

          )}
        </div>
      </div>
    </div>
  );
}

