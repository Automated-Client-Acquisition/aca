import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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
  Wand2,
  Plus,
  Trash2,
  Zap,
  Lightbulb,
  MessageSquare,
  Loader2,
  X,
} from "lucide-react";
import { useGenerateAiAnalysis } from "@/hooks/useGenerateAiAnalysis";
import { useBrandVoices } from "@/hooks/useBrandVoices";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

interface Hook {
  text: string;
  type: string;
}

interface Cta {
  text: string;
  type: string;
  placement: string;
}

interface IdeaAiAnalysisManagerProps {
  ideaId: string;
  ideaTitle: string;
  ideaContext?: string;
  aiAnalysis: any;
  keyTalkingPoints?: string[];
  onAnalysisUpdated?: () => void;
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

type DialogType = "hooks" | "talking_points" | "ctas" | null;

export function IdeaAiAnalysisManager({
  ideaId,
  ideaTitle,
  ideaContext,
  aiAnalysis: rawAiAnalysis,
  keyTalkingPoints: rawTalkingPoints,
  onAnalysisUpdated,
}: IdeaAiAnalysisManagerProps) {
  const [activeDialog, setActiveDialog] = useState<DialogType>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const queryClient = useQueryClient();
  const { brandVoices } = useBrandVoices();
  const {
    generateAiAnalysis,
    isGenerating: isGeneratingFull,
    progress,
    cancelGeneration,
  } = useGenerateAiAnalysis();

  // Parse existing AI analysis
  const aiAnalysis = typeof rawAiAnalysis === "string"
    ? JSON.parse(rawAiAnalysis)
    : rawAiAnalysis || {};

  const existingHooks: Hook[] = aiAnalysis.hooks || [];
  const existingCtas: Cta[] = aiAnalysis.ctas || [];
  const existingTalkingPoints: string[] = rawTalkingPoints || aiAnalysis.talking_points || [];

  // Edit state
  const [hooks, setHooks] = useState<Hook[]>(existingHooks);
  const [ctas, setCtas] = useState<Cta[]>(existingCtas);
  const [talkingPoints, setTalkingPoints] = useState<string[]>(existingTalkingPoints);
  const [isSaving, setIsSaving] = useState(false);

  // Generation options
  const [selectedBrandVoice, setSelectedBrandVoice] = useState<string>("");

  // Sync local state when underlying data changes (e.g., after generation completes)
  useEffect(() => {
    if (activeDialog && !isGenerating && !isGeneratingFull) {
      // Only update if dialog is open and we're not generating
      // This ensures we show fresh data after generation completes
      setHooks(existingHooks);
      setCtas(existingCtas);
      setTalkingPoints(existingTalkingPoints);
    }
  }, [rawAiAnalysis, rawTalkingPoints]);

  // Reset edit state when opening dialog
  const openDialog = (type: DialogType) => {
    setHooks(existingHooks);
    setCtas(existingCtas);
    setTalkingPoints(existingTalkingPoints);
    setActiveDialog(type);
  };

  const closeDialog = () => {
    setActiveDialog(null);
  };

  // Format label from snake_case
  const formatLabel = (text: string) => {
    return text
      .split("_")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  };

  // Save changes to database
  const saveChanges = async (type: DialogType) => {
    setIsSaving(true);
    try {
      const validHooks = hooks.filter((h) => h.text.trim());
      const validCtas = ctas.filter((c) => c.text.trim());
      const validTalkingPoints = talkingPoints.filter((t) => t.trim());

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
        .eq("id", ideaId);

      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ["content-ideas"] });

      const typeLabel = type === "hooks" ? "Hooks" : type === "talking_points" ? "Talking points" : "CTAs";
      toast.success(`${typeLabel} saved`);
      closeDialog();
      onAnalysisUpdated?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save");
    } finally {
      setIsSaving(false);
    }
  };

  // Generate AI analysis for specific type
  const handleGenerateForType = async (type: DialogType) => {
    if (!type) return;

    setIsGenerating(true);

    generateAiAnalysis(
      {
        idea_id: ideaId,
        title: ideaTitle || ideaContext || "Content Idea",
        brand_voice_id: selectedBrandVoice || undefined,
        section: type === "talking_points" ? "talking_points" : type === "hooks" ? "hooks" : "ctas",
      },
      {
        onSuccess: () => {
          // Dialog stays open so user sees the generated content
          // They can close it manually or click Save
          onAnalysisUpdated?.();
          setIsGenerating(false);
        },
        onError: () => {
          setIsGenerating(false);
        },
      }
    );
  };

  // Hook management
  const addHook = () => setHooks([...hooks, { text: "", type: "question" }]);
  const updateHook = (index: number, field: keyof Hook, value: string) => {
    const newHooks = [...hooks];
    newHooks[index] = { ...newHooks[index], [field]: value };
    setHooks(newHooks);
  };
  const removeHook = (index: number) => setHooks(hooks.filter((_, i) => i !== index));

  // Talking point management
  const addTalkingPoint = () => setTalkingPoints([...talkingPoints, ""]);
  const updateTalkingPoint = (index: number, value: string) => {
    const newPoints = [...talkingPoints];
    newPoints[index] = value;
    setTalkingPoints(newPoints);
  };
  const removeTalkingPoint = (index: number) => setTalkingPoints(talkingPoints.filter((_, i) => i !== index));

  // CTA management
  const addCta = () => setCtas([...ctas, { text: "", type: "subscribe", placement: "end" }]);
  const updateCta = (index: number, field: keyof Cta, value: string) => {
    const newCtas = [...ctas];
    newCtas[index] = { ...newCtas[index], [field]: value };
    setCtas(newCtas);
  };
  const removeCta = (index: number) => setCtas(ctas.filter((_, i) => i !== index));

  // Generate button with AI option
  const GenerateSection = ({ type }: { type: DialogType }) => (
    <div className="border-t pt-4 mt-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Generate with AI</p>
          <p className="text-xs text-muted-foreground">
            Let AI create {type === "hooks" ? "hooks" : type === "talking_points" ? "talking points" : "CTAs"} for this idea
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={selectedBrandVoice || "none"} onValueChange={(val) => setSelectedBrandVoice(val === "none" ? "" : val)}>
            <SelectTrigger className="w-[180px] h-8 text-xs">
              <SelectValue placeholder="Brand voice (optional)" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No brand voice</SelectItem>
              {brandVoices?.map((bv) => (
                <SelectItem key={bv.id} value={bv.id}>{bv.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => handleGenerateForType(type)}
            disabled={isGenerating || isGeneratingFull}
            className="gap-1"
          >
            <Wand2 className="h-3.5 w-3.5" />
            Generate
          </Button>
        </div>
      </div>
      {(isGenerating || isGeneratingFull) && (
        <div className="mt-3 p-3 bg-muted/50 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Generating...
            </div>
            <Button variant="ghost" size="sm" onClick={cancelGeneration}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          <pre className="text-xs whitespace-pre-wrap font-mono max-h-[100px] overflow-y-auto">
            {progress || "Starting..."}
          </pre>
        </div>
      )}
    </div>
  );

  return (
    <>
      {/* Inline action buttons */}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => openDialog("hooks")}
          className="gap-1.5 text-yellow-700 border-yellow-500/30 hover:bg-yellow-500/10"
        >
          <Zap className="h-3.5 w-3.5" />
          {existingHooks.length > 0 ? `Hooks (${existingHooks.length})` : "Add Hooks"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => openDialog("talking_points")}
          className="gap-1.5 text-primary border-primary/30 hover:bg-primary/10"
        >
          <Lightbulb className="h-3.5 w-3.5" />
          {existingTalkingPoints.length > 0 ? `Talking Points (${existingTalkingPoints.length})` : "Add Talking Points"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => openDialog("ctas")}
          className="gap-1.5 text-green-700 border-green-500/30 hover:bg-green-500/10"
        >
          <MessageSquare className="h-3.5 w-3.5" />
          {existingCtas.length > 0 ? `CTAs (${existingCtas.length})` : "Add CTAs"}
        </Button>
      </div>

      {/* Hooks Dialog */}
      <Dialog open={activeDialog === "hooks"} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-yellow-500" />
              Hooks
            </DialogTitle>
            <DialogDescription>
              Add attention-grabbing hooks for your content
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="max-h-[300px] pr-4">
            <div className="space-y-2">
              {hooks.map((hook, index) => (
                <div key={index} className="flex gap-2 items-start p-2 rounded-lg border bg-background">
                  <div className="flex-1 space-y-2">
                    <Input
                      value={hook.text}
                      onChange={(e) => updateHook(index, "text", e.target.value)}
                      placeholder="Enter hook text..."
                      className="text-sm"
                    />
                    <Select value={hook.type} onValueChange={(value) => updateHook(index, "type", value)}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {HOOK_TYPES.map((type) => (
                          <SelectItem key={type} value={type}>{formatLabel(type)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => removeHook(index)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={addHook} className="w-full gap-1">
                <Plus className="h-3 w-3" />
                Add Hook Manually
              </Button>
            </div>
          </ScrollArea>

          <GenerateSection type="hooks" />

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>Cancel</Button>
            <Button variant="cta" onClick={() => saveChanges("hooks")} disabled={isSaving}>
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Save Hooks
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Talking Points Dialog */}
      <Dialog open={activeDialog === "talking_points"} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lightbulb className="h-5 w-5 text-primary" />
              Talking Points
            </DialogTitle>
            <DialogDescription>
              Key points to cover in your content
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="max-h-[300px] pr-4">
            <div className="space-y-2">
              {talkingPoints.map((point, index) => (
                <div key={index} className="flex gap-2 items-start">
                  <Textarea
                    value={point}
                    onChange={(e) => updateTalkingPoint(index, e.target.value)}
                    placeholder="Enter talking point..."
                    className="flex-1 text-sm min-h-[60px]"
                  />
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => removeTalkingPoint(index)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={addTalkingPoint} className="w-full gap-1">
                <Plus className="h-3 w-3" />
                Add Talking Point Manually
              </Button>
            </div>
          </ScrollArea>

          <GenerateSection type="talking_points" />

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>Cancel</Button>
            <Button variant="cta" onClick={() => saveChanges("talking_points")} disabled={isSaving}>
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Save Talking Points
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* CTAs Dialog */}
      <Dialog open={activeDialog === "ctas"} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-green-500" />
              Calls to Action
            </DialogTitle>
            <DialogDescription>
              CTAs to include in your content
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="max-h-[300px] pr-4">
            <div className="space-y-2">
              {ctas.map((cta, index) => (
                <div key={index} className="flex gap-2 items-start p-2 rounded-lg border bg-background">
                  <div className="flex-1 space-y-2">
                    <Input
                      value={cta.text}
                      onChange={(e) => updateCta(index, "text", e.target.value)}
                      placeholder="Enter CTA text..."
                      className="text-sm"
                    />
                    <div className="flex gap-2">
                      <Select value={cta.type} onValueChange={(value) => updateCta(index, "type", value)}>
                        <SelectTrigger className="h-8 text-xs flex-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CTA_TYPES.map((type) => (
                            <SelectItem key={type} value={type}>{formatLabel(type)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select value={cta.placement} onValueChange={(value) => updateCta(index, "placement", value)}>
                        <SelectTrigger className="h-8 text-xs flex-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CTA_PLACEMENTS.map((placement) => (
                            <SelectItem key={placement} value={placement}>{formatLabel(placement)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => removeCta(index)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={addCta} className="w-full gap-1">
                <Plus className="h-3 w-3" />
                Add CTA Manually
              </Button>
            </div>
          </ScrollArea>

          <GenerateSection type="ctas" />

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>Cancel</Button>
            <Button variant="cta" onClick={() => saveChanges("ctas")} disabled={isSaving}>
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Save CTAs
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
