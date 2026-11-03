import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useBrandVoices } from "@/hooks/useBrandVoices";
import { useProducts } from "@/hooks/useProducts";
import { useBlocks } from "@/hooks/useBlocks";
import { useCompletedKnowledgeDocuments } from "@/hooks/useKnowledgeBase";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";
import { Sparkles, Mic, ShoppingBag, Compass, BookOpen, Check } from "lucide-react";

interface BulkAnalyzeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedIds: string[];
  onComplete?: () => void;
}

export function BulkAnalyzeDialog({ open, onOpenChange, selectedIds, onComplete }: BulkAnalyzeDialogProps) {
  const { brandVoices } = useBrandVoices();
  const { products } = useProducts();
  const { blocks } = useBlocks('angle');
  const { data: knowledgeDocs = [] } = useCompletedKnowledgeDocuments();
  const queryClient = useQueryClient();

  const [brandVoiceId, setBrandVoiceId] = useState<string>("__none__");
  const [productId, setProductId] = useState<string>("__none__");
  const [contentAngleId, setContentAngleId] = useState<string>("__none__");
  const [selectedKbDocs, setSelectedKbDocs] = useState<string[]>([]);
  const [kbPopoverOpen, setKbPopoverOpen] = useState(false);
  const [additionalDirections, setAdditionalDirections] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleClose = () => {
    if (isSubmitting) return;
    setBrandVoiceId("__none__");
    setProductId("__none__");
    setContentAngleId("__none__");
    setSelectedKbDocs([]);
    setAdditionalDirections("");
    onOpenChange(false);
  };

  const handleGenerate = async () => {
    setIsSubmitting(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      // Mark all selected ideas as generating (optimistic UI update)
      await supabase
        .from('content_ideas')
        .update({ generation_in_progress: true })
        .in('id', selectedIds);

      queryClient.invalidateQueries({ queryKey: ['content-ideas'] });

      const body: Record<string, any> = {
        idea_ids: selectedIds,
      };
      if (brandVoiceId !== "__none__") body.brand_voice_id = brandVoiceId;
      if (productId !== "__none__") body.product_id = productId;
      if (contentAngleId !== "__none__") body.content_angle_id = contentAngleId;
      if (selectedKbDocs.length > 0) body.knowledge_document_ids = selectedKbDocs;
      if (additionalDirections.trim()) body.additional_directions = additionalDirections.trim();

      // Fire and forget — the edge function processes in the background
      // and the realtime subscription in IdeasTable picks up completions
      fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bulk-generate-analysis`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        }
      ).catch((error) => {
        console.error('[Bulk Enrich] Request failed:', error);
        toast.error('Bulk enrichment failed', {
          description: error instanceof Error ? error.message : 'Unknown error',
        });
      });

      const count = selectedIds.length;
      toast.success(`Enriching ${count} idea${count !== 1 ? 's' : ''} in the background`, {
        description: 'You\'ll see progress on each idea as it completes.',
      });

      handleClose();
      onComplete?.();
    } catch (error) {
      toast.error('Failed to start enrichment', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Enrich {selectedIds.length} Idea{selectedIds.length !== 1 ? 's' : ''}
          </DialogTitle>
          <DialogDescription>
            Generate hooks, talking points, and CTAs for selected ideas. Knowledge base documents ground the output in your proven content.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
            <span className="text-xs font-medium text-muted-foreground">Library Elements (optional)</span>
            <div className="space-y-2.5">
              <Select value={brandVoiceId} onValueChange={setBrandVoiceId}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="Brand Voice" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No brand voice</SelectItem>
                  {brandVoices.map((bv) => (
                    <SelectItem key={bv.id} value={bv.id} textValue={bv.name}>
                      <span className="flex items-center gap-1.5"><Mic className="w-3 h-3 text-primary" />{bv.name}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={productId} onValueChange={setProductId}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="Product" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No product</SelectItem>
                  {products.map((p) => (
                    <SelectItem key={p.id} value={p.id} textValue={p.name}>
                      <span className="flex items-center gap-1.5"><ShoppingBag className="w-3 h-3 text-blue-600" />{p.name}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={contentAngleId} onValueChange={setContentAngleId}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="Content Angle" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No content angle</SelectItem>
                  {blocks.map((block) => (
                    <SelectItem key={block.id} value={block.id} textValue={block.name || block.content}>
                      <span className="flex items-center gap-1.5"><Compass className="w-3 h-3 text-orange-600" />{block.name || block.content}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {knowledgeDocs.length > 0 && (
                <Popover open={kbPopoverOpen} onOpenChange={setKbPopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="h-8 w-full justify-start text-sm font-normal">
                      <BookOpen className="w-3 h-3 mr-1.5 text-emerald-600 shrink-0" />
                      {selectedKbDocs.length === 0
                        ? "Knowledge Base"
                        : `${selectedKbDocs.length} doc${selectedKbDocs.length !== 1 ? 's' : ''} selected`}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[260px] p-0" align="start">
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
                              <span className="truncate text-xs">{doc.name}</span>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              )}
            </div>
          </div>

          <Textarea
            placeholder="Custom directions for the AI (optional)&#10;e.g. Focus on pain points around time management, use a confrontational tone..."
            value={additionalDirections}
            onChange={(e) => setAdditionalDirections(e.target.value)}
            className="text-sm min-h-[80px]"
            rows={3}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isSubmitting}>Cancel</Button>
          <Button variant="cta" onClick={handleGenerate} disabled={isSubmitting}>
            <Sparkles className="h-4 w-4 mr-2" />
            Enrich {selectedIds.length} Idea{selectedIds.length !== 1 ? 's' : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
