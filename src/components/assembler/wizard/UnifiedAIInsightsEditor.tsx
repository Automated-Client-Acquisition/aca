import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
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
  Zap,
  Lightbulb,
  MessageSquare,
  Plus,
  Trash2,
  Wand2,
  ChevronDown,
  ChevronUp,
  Loader2,
  X,
  Sparkles,
} from "lucide-react";
import { useGenerateAiAnalysis } from "@/hooks/useGenerateAiAnalysis";
import { useBrandVoices } from "@/hooks/useBrandVoices";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { SelectedAiInsights } from "@/types/wizard";

interface Hook {
  text: string;
  type: string;
}

interface Cta {
  text: string;
  type: string;
  placement: string;
}

interface UnifiedAIInsightsEditorProps {
  ideaId: string;
  ideaTitle: string;
  ideaContext?: string;
  aiAnalysis: any;
  keyTalkingPoints?: string[];
  selectedInsights: SelectedAiInsights | null;
  onInsightsChange: (insights: SelectedAiInsights | null) => void;
  onAnalysisUpdated?: () => void;
  onBeforeGenerate?: () => Promise<string | null>; // Returns new ideaId if idea was saved to DB
}

const HOOK_TYPES = [
  "question",
  "statement",
  "story",
  "statistic",
  "challenge",
  "pattern_interrupt",
];

const CTA_TYPES = [
  "subscribe",
  "like",
  "comment",
  "share",
  "link",
  "buy",
  "question",
];

const CTA_PLACEMENTS = ["opening", "middle", "end"];

type SectionMode = "view" | "edit" | "generate";

const formatLabel = (text: string) => {
  if (!text) return "";
  return text
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
};

// Color classes mapping for Tailwind (can't use dynamic classes)
const colorClasses = {
  yellow: {
    bg: "bg-yellow-500/5",
    border: "border-yellow-500/20",
    text: "text-yellow-500",
    bgPing: "bg-yellow-500/20",
    bgBar: "bg-yellow-500",
  },
  purple: {
    bg: "bg-primary/5",
    border: "border-primary/20",
    text: "text-primary",
    bgPing: "bg-primary/20",
    bgBar: "bg-primary",
  },
  green: {
    bg: "bg-green-500/5",
    border: "border-green-500/20",
    text: "text-green-500",
    bgPing: "bg-green-500/20",
    bgBar: "bg-green-500",
  },
};

// Extracted GeneratePanel component to prevent re-renders causing focus loss
interface GeneratePanelProps {
  section: string;
  color: "yellow" | "purple" | "green";
  isGeneratingThis: boolean;
  cancelGeneration: () => void;
  brandVoices: any[] | undefined;
  sectionBrandVoice: string;
  onBrandVoiceChange: (value: string) => void;
  sectionDirections: string;
  onDirectionsChange: (value: string) => void;
  onGenerate: () => void;
  onCancel: () => void;
  isGenerating: boolean;
}

const GeneratePanel = ({
  section,
  color,
  isGeneratingThis,
  cancelGeneration,
  brandVoices,
  sectionBrandVoice,
  onBrandVoiceChange,
  sectionDirections,
  onDirectionsChange,
  onGenerate,
  onCancel,
  isGenerating,
}: GeneratePanelProps) => {
  const sectionLabel = section === "hooks" ? "Hooks" : section === "talking_points" ? "Talking Points" : "CTAs";
  const colors = colorClasses[color];

  return (
    <div className={`space-y-3 p-3 ${colors.bg} rounded-lg border ${colors.border}`}>
      {isGeneratingThis ? (
        // Generating state
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Loader2 className={`h-5 w-5 ${colors.text} animate-spin`} />
              <div>
                <p className="font-medium text-sm">Generating {sectionLabel}...</p>
                <p className="text-xs text-muted-foreground">This may take a moment</p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={cancelGeneration}>
              <X className="h-4 w-4 mr-1" />
              Cancel
            </Button>
          </div>
          {/* Progress indicator - indeterminate animated bar */}
          <div className="h-1.5 bg-muted rounded-full overflow-hidden relative">
            <div
              className={`absolute h-full w-1/3 ${colors.bgBar} rounded-full animate-[shimmer_1.5s_ease-in-out_infinite]`}
              style={{
                animation: "shimmer 1.5s ease-in-out infinite",
              }}
            />
            <style>{`
              @keyframes shimmer {
                0% { transform: translateX(-100%); }
                100% { transform: translateX(400%); }
              }
            `}</style>
          </div>
          <p className="text-xs text-muted-foreground text-center">
            AI is crafting your {sectionLabel.toLowerCase()}...
          </p>
        </div>
      ) : (
        // Setup state
        <>
          <div className="space-y-2">
            <Label className="text-xs font-medium">Brand Voice (optional)</Label>
            <Select
              value={sectionBrandVoice || "none"}
              onValueChange={(val) => onBrandVoiceChange(val === "none" ? "" : val)}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Select brand voice" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No brand voice</SelectItem>
                {brandVoices?.map((bv) => (
                  <SelectItem key={bv.id} value={bv.id}>
                    {bv.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-xs font-medium">AI Directions (optional)</Label>
            <Textarea
              value={sectionDirections}
              onChange={(e) => onDirectionsChange(e.target.value)}
              placeholder={`Give specific instructions for ${sectionLabel.toLowerCase()}... e.g., 'Focus on humor' or 'Use provocative questions'`}
              className="text-sm min-h-[60px] resize-none"
            />
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={onGenerate}
              disabled={isGenerating}
              className="flex-1"
            >
              <Sparkles className="h-4 w-4 mr-1" />
              Generate {sectionLabel}
            </Button>
            <Button variant="outline" size="sm" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </>
      )}
    </div>
  );
};

const getDefaultInsights = (): SelectedAiInsights => ({
  createVariations: false,
  selectedHookIndices: [],
  hookMode: "combine",
  includeCta: false,
  selectedCtaIndex: null,
  selectedCtaIndices: [],
  ctaMode: "combine",
  includeTalkingPoints: false,
  createTalkingPointVariations: false,
  selectedTalkingPointIndices: [],
  talkingPointMode: "combine",
  includeScriptStructure: false,
  includeEngagementDrivers: false,
});

export function UnifiedAIInsightsEditor({
  ideaId,
  ideaTitle,
  ideaContext,
  aiAnalysis: rawAiAnalysis,
  keyTalkingPoints: rawTalkingPoints,
  selectedInsights,
  onInsightsChange,
  onAnalysisUpdated,
  onBeforeGenerate,
}: UnifiedAIInsightsEditorProps) {
  const queryClient = useQueryClient();
  const { brandVoices } = useBrandVoices();
  const {
    generateAiAnalysis,
    isGenerating,
    cancelGeneration,
  } = useGenerateAiAnalysis();

  // Local state to hold freshly generated content until props update
  const [localGeneratedContent, setLocalGeneratedContent] = useState<{
    hooks?: Hook[];
    talking_points?: string[];
    ctas?: Cta[];
  }>({});

  // Parse existing AI analysis
  const aiAnalysis =
    typeof rawAiAnalysis === "string"
      ? JSON.parse(rawAiAnalysis)
      : rawAiAnalysis || {};

  // Merge props with locally generated content (local takes precedence until props update)
  const existingHooks: Hook[] = localGeneratedContent.hooks || aiAnalysis.hooks || [];
  const existingCtas: Cta[] = localGeneratedContent.ctas || aiAnalysis.ctas || [];
  const existingTalkingPoints: string[] =
    localGeneratedContent.talking_points || rawTalkingPoints || aiAnalysis.talking_points || [];

  // Clear local generated content when props have updated with the same data
  // This ensures we don't keep stale local state
  useEffect(() => {
    if (localGeneratedContent.hooks && aiAnalysis.hooks?.length > 0) {
      setLocalGeneratedContent(prev => ({ ...prev, hooks: undefined }));
    }
    if (localGeneratedContent.ctas && aiAnalysis.ctas?.length > 0) {
      setLocalGeneratedContent(prev => ({ ...prev, ctas: undefined }));
    }
    if (localGeneratedContent.talking_points && (rawTalkingPoints?.length || aiAnalysis.talking_points?.length)) {
      setLocalGeneratedContent(prev => ({ ...prev, talking_points: undefined }));
    }
  }, [aiAnalysis.hooks, aiAnalysis.ctas, aiAnalysis.talking_points, rawTalkingPoints]);

  // Section expansion state
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    hooks: existingHooks.length > 0,
    talking_points: existingTalkingPoints.length > 0,
    ctas: existingCtas.length > 0,
  });

  // Section mode state: "view" | "edit" | "generate"
  const [sectionModes, setSectionModes] = useState<Record<string, SectionMode>>({
    hooks: "view",
    talking_points: "view",
    ctas: "view",
  });

  // Edit state
  const [editHooks, setEditHooks] = useState<Hook[]>(existingHooks);
  const [editTalkingPoints, setEditTalkingPoints] = useState<string[]>(existingTalkingPoints);
  const [editCtas, setEditCtas] = useState<Cta[]>(existingCtas);
  const [isSaving, setIsSaving] = useState(false);

  // Per-section generation state
  const [sectionDirections, setSectionDirections] = useState<Record<string, string>>({
    hooks: "",
    talking_points: "",
    ctas: "",
  });
  const [sectionBrandVoice, setSectionBrandVoice] = useState<Record<string, string>>({
    hooks: "",
    talking_points: "",
    ctas: "",
  });
  const [generatingSection, setGeneratingSection] = useState<string | null>(null);

  // Use defaults if no value set
  const currentValue = selectedInsights || getDefaultInsights();

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const setSectionMode = (section: string, mode: SectionMode) => {
    // Reset edit state when entering edit mode
    if (mode === "edit") {
      // If no items exist, start with one empty item
      setEditHooks(existingHooks.length > 0 ? [...existingHooks] : [{ text: "", type: "question" }]);
      setEditTalkingPoints(existingTalkingPoints.length > 0 ? [...existingTalkingPoints] : [""]);
      setEditCtas(existingCtas.length > 0 ? [...existingCtas] : [{ text: "", type: "subscribe", placement: "end" }]);
    }
    setSectionModes((prev) => ({ ...prev, [section]: mode }));
    // Auto-expand section when changing mode
    setExpandedSections((prev) => ({ ...prev, [section]: true }));
  };

  // Helper to update insights
  const updateInsights = (updates: Partial<SelectedAiInsights>) => {
    onInsightsChange({
      ...currentValue,
      ...updates,
    });
  };

  // Hook selection
  const handleHookToggle = (index: number, checked: boolean) => {
    let newIndices = checked
      ? [...(currentValue.selectedHookIndices || []), index].sort((a, b) => a - b)
      : (currentValue.selectedHookIndices || []).filter((i) => i !== index);

    updateInsights({
      createVariations: newIndices.length > 0,
      selectedHookIndices: newIndices,
    });
  };

  // Talking point selection
  const handleTalkingPointToggle = (index: number, checked: boolean) => {
    let newIndices = checked
      ? [...(currentValue.selectedTalkingPointIndices || []), index].sort((a, b) => a - b)
      : (currentValue.selectedTalkingPointIndices || []).filter((i) => i !== index);

    updateInsights({
      createTalkingPointVariations: newIndices.length > 0,
      selectedTalkingPointIndices: newIndices,
    });
  };

  // CTA selection (now supports multiple)
  const handleCtaToggle = (index: number, checked: boolean) => {
    let newIndices = checked
      ? [...(currentValue.selectedCtaIndices || []), index].sort((a, b) => a - b)
      : (currentValue.selectedCtaIndices || []).filter((i) => i !== index);

    updateInsights({
      includeCta: newIndices.length > 0,
      selectedCtaIndices: newIndices,
      selectedCtaIndex: newIndices.length > 0 ? newIndices[0] : null, // Legacy compatibility
    });
  };

  // Save changes for a section
  const saveChanges = async (section: string) => {
    setIsSaving(true);
    try {
      let effectiveIdeaId = ideaId;

      // If callback provided, check if we need to save the idea first
      if (onBeforeGenerate) {
        try {
          const newId = await onBeforeGenerate();
          if (newId) {
            effectiveIdeaId = newId;
          }
        } catch (error) {
          toast.error("Failed to save idea before saving content");
          setIsSaving(false);
          return;
        }
      }

      const validHooks = editHooks.filter((h) => h.text.trim());
      const validCtas = editCtas.filter((c) => c.text.trim());
      const validTalkingPoints = editTalkingPoints.filter((t) => t.trim());

      const updatedAiAnalysis = {
        ...aiAnalysis,
        hooks: validHooks,
        ctas: validCtas,
      };

      const { error } = await supabase
        .from("content_ideas")
        .update({
          ai_analysis: { ...updatedAiAnalysis, talking_points: validTalkingPoints },
        })
        .eq("id", effectiveIdeaId);

      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ["content-ideas"] });
      toast.success(`${formatLabel(section)} saved`);
      setSectionMode(section, "view");
      onAnalysisUpdated?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save");
    } finally {
      setIsSaving(false);
    }
  };

  // Generate AI for a specific section
  const handleGenerateSection = async (section: string) => {
    let effectiveIdeaId = ideaId;

    // If callback provided, check if we need to save the idea first
    if (onBeforeGenerate) {
      try {
        const newId = await onBeforeGenerate();
        if (newId) {
          effectiveIdeaId = newId;
        }
      } catch (error) {
        toast.error("Failed to save idea before generating");
        return;
      }
    }

    setGeneratingSection(section);

    // Map section to the API parameter type
    const sectionMap: Record<string, 'hooks' | 'talking_points' | 'ctas'> = {
      hooks: 'hooks',
      talking_points: 'talking_points',
      ctas: 'ctas',
    };

    generateAiAnalysis(
      {
        idea_id: effectiveIdeaId,
        title: ideaTitle || ideaContext || "Content Idea",
        brand_voice_id: sectionBrandVoice[section] || undefined,
        additional_directions: sectionDirections[section] || undefined,
        section: sectionMap[section], // Pass the section for focused generation
      },
      {
        onSuccess: (result) => {
          setGeneratingSection(null);

          // Update local state with generated content immediately
          // This ensures the UI shows the new content even before the query refetches
          if (section === 'hooks' && result.ai_analysis?.hooks) {
            setLocalGeneratedContent(prev => ({ ...prev, hooks: result.ai_analysis.hooks }));
          } else if (section === 'talking_points' && result.ai_analysis?.talking_points) {
            setLocalGeneratedContent(prev => ({ ...prev, talking_points: result.ai_analysis.talking_points }));
          } else if (section === 'ctas' && result.ai_analysis?.ctas) {
            setLocalGeneratedContent(prev => ({ ...prev, ctas: result.ai_analysis.ctas }));
          }

          setSectionMode(section, "view");
          onAnalysisUpdated?.();
        },
        onError: () => {
          setGeneratingSection(null);
        },
      }
    );
  };

  // Hook management
  const addHook = () => setEditHooks([...editHooks, { text: "", type: "question" }]);
  const updateHook = (index: number, field: keyof Hook, value: string) => {
    const newHooks = [...editHooks];
    newHooks[index] = { ...newHooks[index], [field]: value };
    setEditHooks(newHooks);
  };
  const removeHook = (index: number) => setEditHooks(editHooks.filter((_, i) => i !== index));

  // Talking point management
  const addTalkingPoint = () => setEditTalkingPoints([...editTalkingPoints, ""]);
  const updateTalkingPoint = (index: number, value: string) => {
    const newPoints = [...editTalkingPoints];
    newPoints[index] = value;
    setEditTalkingPoints(newPoints);
  };
  const removeTalkingPoint = (index: number) =>
    setEditTalkingPoints(editTalkingPoints.filter((_, i) => i !== index));

  // CTA management
  const addCta = () => setEditCtas([...editCtas, { text: "", type: "subscribe", placement: "end" }]);
  const updateCta = (index: number, field: keyof Cta, value: string) => {
    const newCtas = [...editCtas];
    newCtas[index] = { ...newCtas[index], [field]: value };
    setEditCtas(newCtas);
  };
  const removeCta = (index: number) => setEditCtas(editCtas.filter((_, i) => i !== index));

  // Calculate variations count
  const hookVariationsCount = currentValue.createVariations && currentValue.hookMode === "separate"
    ? Math.max(1, (currentValue.selectedHookIndices || []).length)
    : 1;
  const talkingPointVariationsCount =
    currentValue.createTalkingPointVariations && currentValue.talkingPointMode === "separate"
      ? Math.max(1, (currentValue.selectedTalkingPointIndices || []).length)
      : 1;
  const ctaVariationsCount =
    currentValue.includeCta && currentValue.ctaMode === "separate"
      ? Math.max(1, (currentValue.selectedCtaIndices || []).length)
      : 1;
  const totalVariations = hookVariationsCount * talkingPointVariationsCount * ctaVariationsCount;

  // Helper to render generate panel with proper props
  const renderGeneratePanel = (section: string, color: "yellow" | "purple" | "green") => (
    <GeneratePanel
      section={section}
      color={color}
      isGeneratingThis={generatingSection === section}
      cancelGeneration={cancelGeneration}
      brandVoices={brandVoices}
      sectionBrandVoice={sectionBrandVoice[section] || ""}
      onBrandVoiceChange={(val) => setSectionBrandVoice((prev) => ({ ...prev, [section]: val }))}
      sectionDirections={sectionDirections[section] || ""}
      onDirectionsChange={(val) => setSectionDirections((prev) => ({ ...prev, [section]: val }))}
      onGenerate={() => handleGenerateSection(section)}
      onCancel={() => setSectionMode(section, "view")}
      isGenerating={isGenerating}
    />
  );

  // Section Header with mode buttons
  const SectionHeader = ({
    section,
    icon: Icon,
    color,
    label,
    count,
    selectedCount,
  }: {
    section: string;
    icon: any;
    color: "yellow" | "purple" | "green";
    label: string;
    count: number;
    selectedCount: number;
  }) => {
    const mode = sectionModes[section];
    const isExpanded = expandedSections[section];
    const colors = colorClasses[color];

    return (
      <div className={`flex items-center justify-between p-3 ${colors.bg} border-b ${colors.border}`}>
        <CollapsibleTrigger asChild>
          <div className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity flex-1">
            <Icon className={`h-4 w-4 ${colors.text}`} />
            <span className="font-medium text-sm">{label}</span>
            {count > 0 && (
              <Badge variant="secondary" className="text-xs">
                {selectedCount}/{count} selected
              </Badge>
            )}
            {count === 0 && (
              <span className="text-xs text-muted-foreground">None yet</span>
            )}
            {isExpanded ? (
              <ChevronUp className="h-4 w-4 ml-auto" />
            ) : (
              <ChevronDown className="h-4 w-4 ml-auto" />
            )}
          </div>
        </CollapsibleTrigger>
        {/* Action buttons */}
        <div className="flex items-center gap-1 ml-2">
          <Button
            variant={mode === "edit" ? "default" : "ghost"}
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={(e) => {
              e.stopPropagation();
              setSectionMode(section, mode === "edit" ? "view" : "edit");
            }}
            disabled={isGenerating}
          >
            <Plus className="h-3 w-3 mr-1" />
            Add
          </Button>
          <Button
            variant={mode === "generate" ? "default" : "ghost"}
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={(e) => {
              e.stopPropagation();
              setSectionMode(section, mode === "generate" ? "view" : "generate");
            }}
            disabled={isGenerating && generatingSection !== section}
          >
            {generatingSection === section ? (
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            ) : (
              <Wand2 className="h-3 w-3 mr-1" />
            )}
            Generate
          </Button>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Hooks Section */}
      <Collapsible open={expandedSections.hooks} onOpenChange={() => toggleSection("hooks")}>
        <div className="border rounded-lg overflow-hidden">
          <SectionHeader
            section="hooks"
            icon={Zap}
            color="yellow"
            label="Hooks"
            count={existingHooks.length}
            selectedCount={(currentValue.selectedHookIndices || []).length}
          />
          <CollapsibleContent>
            <div className="p-3 space-y-3">
              {/* Generate Mode */}
              {sectionModes.hooks === "generate" && renderGeneratePanel("hooks", "yellow")}

              {/* Edit Mode */}
              {sectionModes.hooks === "edit" && (
                <>
                  <ScrollArea className="max-h-[250px] pr-2">
                    <div className="space-y-2">
                      {editHooks.map((hook, index) => (
                        <div key={index} className="flex gap-2 items-start">
                          <div className="flex-1 space-y-1">
                            <Input
                              value={hook.text}
                              onChange={(e) => updateHook(index, "text", e.target.value)}
                              placeholder="Hook text..."
                              className="h-8 text-sm"
                            />
                            <Select
                              value={hook.type}
                              onValueChange={(value) => updateHook(index, "type", value)}
                            >
                              <SelectTrigger className="h-7 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {HOOK_TYPES.map((type) => (
                                  <SelectItem key={type} value={type}>
                                    {formatLabel(type)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive"
                            onClick={() => removeHook(index)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={addHook} className="flex-1">
                      <Plus className="h-3 w-3 mr-1" />
                      Add Hook
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setSectionMode("hooks", "view")}>
                      Cancel
                    </Button>
                    <Button size="sm" onClick={() => saveChanges("hooks")} disabled={isSaving}>
                      {isSaving && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                      Save
                    </Button>
                  </div>
                </>
              )}

              {/* View/Select Mode */}
              {sectionModes.hooks === "view" && (
                <>
                  {existingHooks.length > 0 ? (
                    <>
                      {existingHooks.length > 1 && (
                        <div className="space-y-2 pb-2 border-b">
                          <div className="flex items-center justify-between">
                            <Label className="text-xs text-muted-foreground">
                              Select hooks to use
                            </Label>
                            <Switch
                              checked={currentValue.createVariations}
                              onCheckedChange={(checked) =>
                                updateInsights({
                                  createVariations: checked,
                                  selectedHookIndices: checked ? existingHooks.map((_, i) => i) : [],
                                })
                              }
                            />
                          </div>
                          {currentValue.createVariations && (
                            <div className="flex gap-2">
                              <Button
                                variant={currentValue.hookMode === "combine" ? "default" : "outline"}
                                size="sm"
                                className="flex-1 h-7 text-xs"
                                onClick={() => updateInsights({ hookMode: "combine" })}
                              >
                                Combine All
                              </Button>
                              <Button
                                variant={currentValue.hookMode === "separate" ? "default" : "outline"}
                                size="sm"
                                className="flex-1 h-7 text-xs"
                                onClick={() => updateInsights({ hookMode: "separate" })}
                              >
                                Separate Outputs
                              </Button>
                            </div>
                          )}
                        </div>
                      )}
                      <ScrollArea className="max-h-[250px] pr-2">
                        <div className="space-y-2">
                          {existingHooks.map((hook, index) => {
                            const isSelected = (currentValue.selectedHookIndices || []).includes(index);
                            return (
                              <div
                                key={index}
                                className={`flex items-start gap-2 p-2 rounded-lg border cursor-pointer transition-colors ${
                                  isSelected
                                    ? "bg-yellow-500/10 border-yellow-500/30"
                                    : "hover:bg-muted/50"
                                }`}
                                onClick={() => handleHookToggle(index, !isSelected)}
                              >
                                <Checkbox
                                  checked={isSelected}
                                  onCheckedChange={(checked) => handleHookToggle(index, checked as boolean)}
                                  className="mt-0.5"
                                />
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm">"{hook.text}"</p>
                                  <Badge variant="outline" className="text-xs mt-1">
                                    {formatLabel(hook.type)}
                                  </Badge>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </ScrollArea>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No hooks yet. Click "Add" to create manually or "Generate" to use AI.
                    </p>
                  )}
                </>
              )}
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>

      {/* Talking Points Section */}
      <Collapsible
        open={expandedSections.talking_points}
        onOpenChange={() => toggleSection("talking_points")}
      >
        <div className="border rounded-lg overflow-hidden">
          <SectionHeader
            section="talking_points"
            icon={Lightbulb}
            color="purple"
            label="Talking Points"
            count={existingTalkingPoints.length}
            selectedCount={(currentValue.selectedTalkingPointIndices || []).length}
          />
          <CollapsibleContent>
            <div className="p-3 space-y-3">
              {/* Generate Mode */}
              {sectionModes.talking_points === "generate" && renderGeneratePanel("talking_points", "purple")}

              {/* Edit Mode */}
              {sectionModes.talking_points === "edit" && (
                <>
                  <ScrollArea className="max-h-[250px] pr-2">
                    <div className="space-y-2">
                      {editTalkingPoints.map((point, index) => (
                        <div key={index} className="flex gap-2 items-start">
                          <Textarea
                            value={point}
                            onChange={(e) => updateTalkingPoint(index, e.target.value)}
                            placeholder="Talking point..."
                            className="flex-1 text-sm min-h-[60px]"
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive"
                            onClick={() => removeTalkingPoint(index)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={addTalkingPoint} className="flex-1">
                      <Plus className="h-3 w-3 mr-1" />
                      Add Point
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSectionMode("talking_points", "view")}
                    >
                      Cancel
                    </Button>
                    <Button size="sm" onClick={() => saveChanges("talking_points")} disabled={isSaving}>
                      {isSaving && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                      Save
                    </Button>
                  </div>
                </>
              )}

              {/* View/Select Mode */}
              {sectionModes.talking_points === "view" && (
                <>
                  {existingTalkingPoints.length > 0 ? (
                    <>
                      {existingTalkingPoints.length > 1 && (
                        <div className="space-y-2 pb-2 border-b">
                          <div className="flex items-center justify-between">
                            <Label className="text-xs text-muted-foreground">
                              Select talking points to use
                            </Label>
                            <Switch
                              checked={currentValue.createTalkingPointVariations}
                              onCheckedChange={(checked) =>
                                updateInsights({
                                  createTalkingPointVariations: checked,
                                  selectedTalkingPointIndices: checked
                                    ? existingTalkingPoints.map((_, i) => i)
                                    : [],
                                })
                              }
                            />
                          </div>
                          {currentValue.createTalkingPointVariations && (
                            <div className="flex gap-2">
                              <Button
                                variant={currentValue.talkingPointMode === "combine" ? "default" : "outline"}
                                size="sm"
                                className="flex-1 h-7 text-xs"
                                onClick={() => updateInsights({ talkingPointMode: "combine" })}
                              >
                                Combine All
                              </Button>
                              <Button
                                variant={currentValue.talkingPointMode === "separate" ? "default" : "outline"}
                                size="sm"
                                className="flex-1 h-7 text-xs"
                                onClick={() => updateInsights({ talkingPointMode: "separate" })}
                              >
                                Separate Outputs
                              </Button>
                            </div>
                          )}
                        </div>
                      )}
                      <ScrollArea className="max-h-[250px] pr-2">
                        <div className="space-y-2">
                          {existingTalkingPoints.map((point, index) => {
                            const isSelected = (currentValue.selectedTalkingPointIndices || []).includes(
                              index
                            );
                            return (
                              <div
                                key={index}
                                className={`flex items-start gap-2 p-2 rounded-lg border cursor-pointer transition-colors ${
                                  isSelected
                                    ? "bg-primary/10 border-primary/30"
                                    : "hover:bg-muted/50"
                                }`}
                                onClick={() => handleTalkingPointToggle(index, !isSelected)}
                              >
                                <Checkbox
                                  checked={isSelected}
                                  onCheckedChange={(checked) =>
                                    handleTalkingPointToggle(index, checked as boolean)
                                  }
                                  className="mt-0.5"
                                />
                                <p className="flex-1 text-sm">{point}</p>
                              </div>
                            );
                          })}
                        </div>
                      </ScrollArea>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No talking points yet. Click "Add" to create manually or "Generate" to use AI.
                    </p>
                  )}
                </>
              )}
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>

      {/* CTAs Section */}
      <Collapsible open={expandedSections.ctas} onOpenChange={() => toggleSection("ctas")}>
        <div className="border rounded-lg overflow-hidden">
          <SectionHeader
            section="ctas"
            icon={MessageSquare}
            color="green"
            label="CTAs"
            count={existingCtas.length}
            selectedCount={(currentValue.selectedCtaIndices || []).length}
          />
          <CollapsibleContent>
            <div className="p-3 space-y-3">
              {/* Generate Mode */}
              {sectionModes.ctas === "generate" && renderGeneratePanel("ctas", "green")}

              {/* Edit Mode */}
              {sectionModes.ctas === "edit" && (
                <>
                  <ScrollArea className="max-h-[250px] pr-2">
                    <div className="space-y-2">
                      {editCtas.map((cta, index) => (
                        <div key={index} className="flex gap-2 items-start">
                          <div className="flex-1 space-y-1">
                            <Input
                              value={cta.text}
                              onChange={(e) => updateCta(index, "text", e.target.value)}
                              placeholder="CTA text..."
                              className="h-8 text-sm"
                            />
                            <div className="flex gap-1">
                              <Select
                                value={cta.type}
                                onValueChange={(value) => updateCta(index, "type", value)}
                              >
                                <SelectTrigger className="h-7 text-xs flex-1">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {CTA_TYPES.map((type) => (
                                    <SelectItem key={type} value={type}>
                                      {formatLabel(type)}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <Select
                                value={cta.placement}
                                onValueChange={(value) => updateCta(index, "placement", value)}
                              >
                                <SelectTrigger className="h-7 text-xs flex-1">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {CTA_PLACEMENTS.map((placement) => (
                                    <SelectItem key={placement} value={placement}>
                                      {formatLabel(placement)}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive"
                            onClick={() => removeCta(index)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={addCta} className="flex-1">
                      <Plus className="h-3 w-3 mr-1" />
                      Add CTA
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setSectionMode("ctas", "view")}>
                      Cancel
                    </Button>
                    <Button size="sm" onClick={() => saveChanges("ctas")} disabled={isSaving}>
                      {isSaving && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                      Save
                    </Button>
                  </div>
                </>
              )}

              {/* View/Select Mode */}
              {sectionModes.ctas === "view" && (
                <>
                  {existingCtas.length > 0 ? (
                    <>
                      {existingCtas.length > 0 && (
                        <div className="space-y-2 pb-2 border-b">
                          <div className="flex items-center justify-between">
                            <Label className="text-xs text-muted-foreground">
                              Select CTAs to use
                            </Label>
                            <Switch
                              checked={currentValue.includeCta}
                              onCheckedChange={(checked) =>
                                updateInsights({
                                  includeCta: checked,
                                  selectedCtaIndices: checked ? existingCtas.map((_, i) => i) : [],
                                  selectedCtaIndex: checked ? 0 : null,
                                })
                              }
                            />
                          </div>
                          {currentValue.includeCta && existingCtas.length > 1 && (
                            <div className="flex gap-2">
                              <Button
                                variant={currentValue.ctaMode === "combine" ? "default" : "outline"}
                                size="sm"
                                className="flex-1 h-7 text-xs"
                                onClick={() => updateInsights({ ctaMode: "combine" })}
                              >
                                Combine All
                              </Button>
                              <Button
                                variant={currentValue.ctaMode === "separate" ? "default" : "outline"}
                                size="sm"
                                className="flex-1 h-7 text-xs"
                                onClick={() => updateInsights({ ctaMode: "separate" })}
                              >
                                Separate Outputs
                              </Button>
                            </div>
                          )}
                        </div>
                      )}
                      <ScrollArea className="max-h-[250px] pr-2">
                        <div className="space-y-2">
                          {existingCtas.map((cta, index) => {
                            const isSelected = (currentValue.selectedCtaIndices || []).includes(index);
                            return (
                              <div
                                key={index}
                                className={`flex items-start gap-2 p-2 rounded-lg border cursor-pointer transition-colors ${
                                  isSelected ? "bg-green-500/10 border-green-500/30" : "hover:bg-muted/50"
                                }`}
                                onClick={() => handleCtaToggle(index, !isSelected)}
                              >
                                <Checkbox
                                  checked={isSelected}
                                  onCheckedChange={(checked) => handleCtaToggle(index, checked as boolean)}
                                  className="mt-0.5"
                                />
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm">"{cta.text}"</p>
                                  <div className="flex gap-1 mt-1">
                                    <Badge variant="outline" className="text-xs">
                                      {formatLabel(cta.type)}
                                    </Badge>
                                    <Badge variant="secondary" className="text-xs">
                                      {formatLabel(cta.placement)}
                                    </Badge>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </ScrollArea>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No CTAs yet. Click "Add" to create manually or "Generate" to use AI.
                    </p>
                  )}
                </>
              )}
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>

      {/* Variations Summary */}
      {totalVariations > 1 && (
        <div className="bg-gradient-to-r from-yellow-500/10 via-primary/10 to-green-500/10 rounded-lg p-3 text-sm border">
          <span className="font-medium">
            Will generate {totalVariations} variation{totalVariations !== 1 ? "s" : ""}
          </span>
          <p className="text-xs text-muted-foreground mt-1">
            {[
              hookVariationsCount > 1 && `${hookVariationsCount} hooks`,
              talkingPointVariationsCount > 1 && `${talkingPointVariationsCount} talking points`,
              ctaVariationsCount > 1 && `${ctaVariationsCount} CTAs`,
            ]
              .filter(Boolean)
              .join(" × ")}
          </p>
        </div>
      )}
    </div>
  );
}
