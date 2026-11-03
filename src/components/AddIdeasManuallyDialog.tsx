import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Plus, Trash2, PenLine } from "lucide-react";
import { useIdeas } from "@/hooks/useIdeas";
import { useBrandVoices } from "@/hooks/useBrandVoices";
import { useProducts } from "@/hooks/useProducts";
import { useBlocks } from "@/hooks/useBlocks";

import { FeedTargetSelect } from "@/components/ideas/FeedTargetSelect";
import { NO_FEED, findFeedOption } from "@/lib/idea-feeds";
import { useAssignIdeasToAutopilot, useFeedOptions } from "@/hooks/useIdeaFeeds";

interface AddIdeasManuallyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Preselect this autopilot as the one that posts the new ideas. */
  autopilotId?: string | null;
}

interface ManualIdea {
  id: string;
  title: string;
}

export function AddIdeasManuallyDialog({ open, onOpenChange, autopilotId }: AddIdeasManuallyDialogProps) {
  const [ideas, setIdeas] = useState<ManualIdea[]>([{ id: crypto.randomUUID(), title: "" }]);
  const [brandVoiceId, setBrandVoiceId] = useState<string>("");
  const [productId, setProductId] = useState<string>("");
  const [contentAngleId, setContentAngleId] = useState<string>("");
  const [bulkInput, setBulkInput] = useState("");
  const [showBulkInput, setShowBulkInput] = useState(false);
  const [feedKey, setFeedKey] = useState(NO_FEED);

  const { createBulkIdeas, isCreatingBulk } = useIdeas();
  const { options: feedOptions } = useFeedOptions();
  const assignToAutopilot = useAssignIdeasToAutopilot();
  const { brandVoices } = useBrandVoices();
  const { products } = useProducts();
  const { blocks } = useBlocks('angle');

  const addIdea = () => {
    setIdeas([...ideas, { id: crypto.randomUUID(), title: "" }]);
  };

  const removeIdea = (id: string) => {
    if (ideas.length > 1) {
      setIdeas(ideas.filter(idea => idea.id !== id));
    }
  };

  const updateIdea = (id: string, title: string) => {
    setIdeas(ideas.map(idea => idea.id === id ? { ...idea, title } : idea));
  };

  const parseBulkInput = () => {
    const lines = bulkInput
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);

    if (lines.length > 0) {
      const newIdeas = lines.map(title => ({ id: crypto.randomUUID(), title }));
      setIdeas(newIdeas);
      setBulkInput("");
      setShowBulkInput(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const validIdeas = ideas.filter(idea => idea.title.trim().length > 0);
    if (validIdeas.length === 0) return;

    try {
      const created = await createBulkIdeas(
        validIdeas.map(idea => ({
          title: idea.title.trim(),
          brand_voice_id: brandVoiceId || null,
          product_id: productId || null,
          content_angle_id: contentAngleId || null,
        }))
      );
      const feed = findFeedOption(feedOptions, feedKey);
      if (feed && created?.length) {
        assignToAutopilot.mutate({ ideaIds: created.map((i: { id: string }) => i.id), target: feed.target });
      }
      handleClose();
    } catch (error) {
      console.error('Error creating ideas:', error);
    }
  };

  const handleClose = () => {
    setIdeas([{ id: crypto.randomUUID(), title: "" }]);
    setBrandVoiceId("");
    setProductId("");
    setContentAngleId("");
    setBulkInput("");
    setShowBulkInput(false);
    setFeedKey(NO_FEED);
    onOpenChange(false);
  };

  const validIdeasCount = ideas.filter(idea => idea.title.trim().length > 0).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl h-[80vh] flex flex-col p-0">
        <div className="shrink-0 p-6 pb-4 border-b">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PenLine className="w-5 h-5 text-primary" />
              Add Ideas Manually
            </DialogTitle>
            <DialogDescription>
              Add content ideas directly without AI generation. Perfect for ideas you already have in mind.
            </DialogDescription>
          </DialogHeader>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <ScrollArea className="flex-1 px-6">
            <div className="space-y-6 py-4">
              {/* Bulk paste option */}
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Ideas</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowBulkInput(!showBulkInput)}
                  className="text-xs"
                >
                  {showBulkInput ? "Single entry mode" : "Paste multiple"}
                </Button>
              </div>

              {showBulkInput ? (
                <div className="space-y-3">
                  <Textarea
                    placeholder="Paste multiple ideas, one per line..."
                    value={bulkInput}
                    onChange={(e) => setBulkInput(e.target.value)}
                    className="min-h-[200px] font-mono text-sm"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={parseBulkInput}
                    disabled={!bulkInput.trim()}
                  >
                    Parse {bulkInput.split('\n').filter(l => l.trim()).length} ideas
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {ideas.map((idea, index) => (
                    <div key={idea.id} className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground w-6">{index + 1}.</span>
                      <Input
                        placeholder="Enter idea title..."
                        value={idea.title}
                        onChange={(e) => updateIdea(idea.id, e.target.value)}
                        disabled={isCreatingBulk}
                        className="flex-1"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeIdea(idea.id)}
                        disabled={ideas.length === 1 || isCreatingBulk}
                        className="shrink-0"
                      >
                        <Trash2 className="w-4 h-4 text-muted-foreground" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addIdea}
                    disabled={isCreatingBulk}
                    className="w-full"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Add another idea
                  </Button>
                </div>
              )}

              <FeedTargetSelect id="manual-ideas-feed" value={feedKey} onChange={setFeedKey} autopilotId={autopilotId} />

              {/* Optional Library Elements */}
              <div className="space-y-4 pt-4 border-t">
                <div>
                  <h3 className="text-sm font-medium mb-1">
                    Associate with Library Elements (Optional)
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Apply to all ideas being added
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="brand-voice" className="text-xs">Brand Voice</Label>
                    <Select
                      value={brandVoiceId || undefined}
                      onValueChange={setBrandVoiceId}
                      disabled={isCreatingBulk}
                    >
                      <SelectTrigger id="brand-voice">
                        <SelectValue placeholder="None" />
                      </SelectTrigger>
                      <SelectContent>
                        {brandVoices.map((bv) => (
                          <SelectItem key={bv.id} value={bv.id}>
                            {bv.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="product" className="text-xs">Product</Label>
                    <Select
                      value={productId || undefined}
                      onValueChange={setProductId}
                      disabled={isCreatingBulk}
                    >
                      <SelectTrigger id="product">
                        <SelectValue placeholder="None" />
                      </SelectTrigger>
                      <SelectContent>
                        {products.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="content-angle" className="text-xs">Content Angle</Label>
                    <Select
                      value={contentAngleId || undefined}
                      onValueChange={setContentAngleId}
                      disabled={isCreatingBulk}
                    >
                      <SelectTrigger id="content-angle">
                        <SelectValue placeholder="None" />
                      </SelectTrigger>
                      <SelectContent>
                        {blocks.map((block) => (
                          <SelectItem key={block.id} value={block.id}>
                            {block.name || block.content}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            </div>
          </ScrollArea>

          {/* Actions */}
          <div className="shrink-0 flex gap-3 justify-between items-center p-6 pt-4 border-t bg-background">
            <p className="text-sm text-muted-foreground">
              {validIdeasCount} idea{validIdeasCount !== 1 ? 's' : ''} to add
            </p>
            <div className="flex gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={handleClose}
                disabled={isCreatingBulk}
              >
                Cancel
              </Button>
              <Button variant="cta" type="submit" disabled={isCreatingBulk || validIdeasCount === 0}>
                {isCreatingBulk ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Adding...
                  </>
                ) : (
                  <>
                    <Plus className="w-4 h-4 mr-2" />
                    Add {validIdeasCount} Idea{validIdeasCount !== 1 ? 's' : ''}
                  </>
                )}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
