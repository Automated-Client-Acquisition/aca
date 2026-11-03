import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ContentIdea } from "@/hooks/useIdeas";
import { useBrandVoices } from "@/hooks/useBrandVoices";
import { useProducts } from "@/hooks/useProducts";
import { useBlocks } from "@/hooks/useBlocks";
import { useState } from "react";
import { Loader2, Mic, ShoppingBag, Compass, Plus, X, Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

interface GenerateVariationsDialogProps {
  idea: ContentIdea;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface VariationConfig {
  id: string;
  brandVoiceId: string;
  productId: string;
  contentAngleId: string;
}

export function GenerateVariationsDialog({ idea, open, onOpenChange }: GenerateVariationsDialogProps) {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();
  const { brandVoices } = useBrandVoices();
  const { products } = useProducts();
  const { blocks } = useBlocks('angle');

  const [variations, setVariations] = useState<VariationConfig[]>([
    { id: crypto.randomUUID(), brandVoiceId: "__none__", productId: "__none__", contentAngleId: "__none__" }
  ]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [keepOriginalElements, setKeepOriginalElements] = useState(false);
  const [generateUniqueTitles, setGenerateUniqueTitles] = useState(true);

  const addVariation = () => {
    setVariations([
      ...variations,
      {
        id: crypto.randomUUID(),
        brandVoiceId: keepOriginalElements ? (idea.brand_voice_id || "__none__") : "__none__",
        productId: keepOriginalElements ? (idea.product_id || "__none__") : "__none__",
        contentAngleId: keepOriginalElements ? (idea.content_angle_id || "__none__") : "__none__"
      }
    ]);
  };

  const removeVariation = (id: string) => {
    if (variations.length > 1) {
      setVariations(variations.filter(v => v.id !== id));
    }
  };

  const updateVariation = (id: string, field: keyof Omit<VariationConfig, 'id'>, value: string) => {
    setVariations(variations.map(v =>
      v.id === id ? { ...v, [field]: value } : v
    ));
  };

  const handleGenerate = async () => {
    setIsGenerating(true);

    const toastId = `generate-variations-${idea.id}`;
    toast.loading(`Generating ${variations.length} unique variation${variations.length > 1 ? 's' : ''}...`, {
      description: "AI is creating fresh content for each variation",
      id: toastId,
    });

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      // Use currentOrganization from AuthContext - it already respects impersonation
      if (!currentOrganization) throw new Error('No organization context');

      // Step 1: Create idea records with generation_in_progress flag
      const variationsToInsert = variations.map(v => ({
        title: idea.title, // Will be updated by AI if generate_unique is true
        organization_id: currentOrganization.id,
        brand_voice_id: v.brandVoiceId === "__none__" ? null : v.brandVoiceId,
        product_id: v.productId === "__none__" ? null : v.productId,
        content_angle_id: v.contentAngleId === "__none__" ? null : v.contentAngleId,
        generation_in_progress: true,
      }));

      const { data: createdIdeas, error: insertError } = await supabase
        .from('content_ideas')
        .insert(variationsToInsert)
        .select();

      if (insertError) throw insertError;

      // Close the dialog - generation will happen in background
      onOpenChange(false);

      // Dismiss the loading toast immediately - the badge on cards will show progress
      toast.dismiss(toastId);

      // Reset state
      setVariations([{ id: crypto.randomUUID(), brandVoiceId: "__none__", productId: "__none__", contentAngleId: "__none__" }]);

      // Invalidate to show the new ideas with "Generating..." badge
      queryClient.invalidateQueries({ queryKey: ['content-ideas'] });

      // Step 2: Trigger AI generation for each created idea
      let successCount = 0;
      let errorCount = 0;

      for (const createdIdea of createdIdeas || []) {
        try {
          const response = await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-content-idea`,
            {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${session.access_token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                idea_id: createdIdea.id,
                title: idea.title,
                brand_voice_id: createdIdea.brand_voice_id,
                product_id: createdIdea.product_id,
                content_angle_id: createdIdea.content_angle_id,
                generate_unique: generateUniqueTitles,
              }),
            }
          );

          if (!response.ok) {
            throw new Error(`Generation failed: ${response.status}`);
          }

          // Process the SSE stream to completion
          const reader = response.body?.getReader();
          if (reader) {
            const decoder = new TextDecoder();
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              const chunk = decoder.decode(value);
              // Check for errors in the stream
              if (chunk.includes('"type":"error"')) {
                const errorMatch = chunk.match(/"error":"([^"]+)"/);
                throw new Error(errorMatch?.[1] || 'Generation error');
              }
            }
          }

          successCount++;
        } catch (err) {
          console.error(`Failed to generate variation ${createdIdea.id}:`, err);
          errorCount++;

          // Clear the generation flag on error
          await supabase
            .from('content_ideas')
            .update({ generation_in_progress: false })
            .eq('id', createdIdea.id);
        }
      }

      if (successCount > 0 && errorCount === 0) {
        toast.success(`Created ${successCount} unique variation${successCount > 1 ? 's' : ''}!`, {
          description: "AI-generated content is ready in your Ideas list",
        });
      } else if (successCount > 0 && errorCount > 0) {
        toast.warning(`Created ${successCount} variation${successCount > 1 ? 's' : ''}, ${errorCount} failed`, {
          description: "Some variations could not be generated",
        });
      } else {
        toast.error("Failed to generate variations", {
          description: "Please try again",
        });
      }

      queryClient.invalidateQueries({ queryKey: ['content-ideas'] });

    } catch (error: any) {
      toast.error("Failed to create variations", {
        description: error.message,
      });
    } finally {
      // Always dismiss the loading toast in finally to prevent stuck toasts
      toast.dismiss(toastId);
      setIsGenerating(false);
    }
  };

  const getElementName = (type: 'brandVoice' | 'product' | 'contentAngle', id: string): string => {
    if (id === "__none__") return "None";

    switch (type) {
      case 'brandVoice':
        return brandVoices.find(bv => bv.id === id)?.name || "Unknown";
      case 'product':
        return products.find(p => p.id === id)?.name || "Unknown";
      case 'contentAngle':
        return blocks.find(b => b.id === id)?.name || blocks.find(b => b.id === id)?.content || "Unknown";
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="w-5 h-5 text-primary" />
            Generate Variations
          </DialogTitle>
          <DialogDescription>
            Create unique AI-generated variations of this idea with different library elements
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-6 py-4">
          {/* Original Idea Info */}
          <div className="rounded-lg border border-border/50 bg-muted/20 p-4">
            <div className="text-sm font-medium mb-2">Original Idea</div>
            <p className="text-sm text-foreground mb-3">{idea.title}</p>
            <div className="flex items-center gap-2 flex-wrap">
              {idea.brand_voice && (
                <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-primary/10 border border-primary/20">
                  <Mic className="w-3 h-3 text-primary" />
                  <span className="text-xs font-medium text-primary">{idea.brand_voice.name}</span>
                </div>
              )}
              {idea.product && (
                <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-blue-500/10 border border-blue-500/20">
                  <ShoppingBag className="w-3 h-3 text-blue-600" />
                  <span className="text-xs font-medium text-blue-600">{idea.product.name}</span>
                </div>
              )}
              {idea.content_angle && (
                <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-orange-500/10 border border-orange-500/20">
                  <Compass className="w-3 h-3 text-orange-600" />
                  <span className="text-xs font-medium text-orange-600">{idea.content_angle.name}</span>
                </div>
              )}
              {!idea.brand_voice && !idea.product && !idea.content_angle && (
                <span className="text-xs text-muted-foreground">No library elements</span>
              )}
            </div>
          </div>

          {/* Options */}
          <div className="space-y-3">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="generate-unique"
                checked={generateUniqueTitles}
                onCheckedChange={(checked) => setGenerateUniqueTitles(checked === true)}
              />
              <label
                htmlFor="generate-unique"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                Generate unique titles for each variation
              </label>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="keep-elements"
                checked={keepOriginalElements}
                onCheckedChange={(checked) => setKeepOriginalElements(checked === true)}
              />
              <label
                htmlFor="keep-elements"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                Pre-fill new variations with original elements
              </label>
            </div>
          </div>

          {/* Info Box */}
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
            <div className="flex items-start gap-3">
              <Sparkles className="w-5 h-5 text-primary mt-0.5" />
              <div className="text-sm text-muted-foreground">
                <p className="font-medium text-foreground mb-1">How it works</p>
                <p>Each variation will be generated with fresh AI content based on the selected library elements.
                The AI will create unique hooks, CTAs, talking points, and strategies tailored to each combination.</p>
              </div>
            </div>
          </div>

          {/* Variations */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Variations to Generate</Label>
              <Button variant="outline" size="sm" onClick={addVariation} className="gap-1.5">
                <Plus className="w-3.5 h-3.5" />
                Add Variation
              </Button>
            </div>

            <div className="space-y-3">
              {variations.map((variation, index) => (
                <div
                  key={variation.id}
                  className="rounded-lg border border-border/50 bg-background p-4 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-muted-foreground">
                      Variation {index + 1}
                    </span>
                    {variations.length > 1 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeVariation(variation.id)}
                        className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Brand Voice</Label>
                      <Select
                        value={variation.brandVoiceId}
                        onValueChange={(value) => updateVariation(variation.id, 'brandVoiceId', value)}
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="Select brand voice" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">None</SelectItem>
                          {brandVoices.map((bv) => (
                            <SelectItem key={bv.id} value={bv.id} textValue={bv.name}>
                              <div className="flex items-center gap-2">
                                <Mic className="w-3 h-3 text-primary" />
                                {bv.name}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Product</Label>
                      <Select
                        value={variation.productId}
                        onValueChange={(value) => updateVariation(variation.id, 'productId', value)}
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="Select product" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">None</SelectItem>
                          {products.map((p) => (
                            <SelectItem key={p.id} value={p.id} textValue={p.name}>
                              <div className="flex items-center gap-2">
                                <ShoppingBag className="w-3 h-3 text-blue-600" />
                                {p.name}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Content Angle</Label>
                      <Select
                        value={variation.contentAngleId}
                        onValueChange={(value) => updateVariation(variation.id, 'contentAngleId', value)}
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="Select angle" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">None</SelectItem>
                          {blocks.map((block) => (
                            <SelectItem key={block.id} value={block.id}>
                              <div className="flex items-center gap-2">
                                <Compass className="w-3 h-3 text-orange-600" />
                                {block.name || block.content}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-4 border-t">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="flex-1"
            disabled={isGenerating}
          >
            Cancel
          </Button>
          <Button
            onClick={handleGenerate}
            className="flex-1 gap-2"
            disabled={isGenerating || variations.length === 0}
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Wand2 className="w-4 h-4" />
                Generate {variations.length} Variation{variations.length > 1 ? 's' : ''}
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
