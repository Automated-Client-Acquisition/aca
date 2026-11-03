import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useState } from "react";
import { useBlocks, BlockType } from "@/hooks/useBlocks";
import { FileText, Sparkles, Hash, Zap, Target, BookOpen, Palette, Check, LayoutGrid } from "lucide-react";
import { EditableList } from "./EditableList";

interface AddBlockDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddBlockDialog({ open, onOpenChange }: AddBlockDialogProps) {
  const { createBlock, isCreating } = useBlocks();
  const [blockType, setBlockType] = useState<BlockType>("hook");
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [tags, setTags] = useState<string[]>([]);

  const handleSubmit = async () => {
    await createBlock({
      block_type: blockType,
      name,
      content: content || null,
      tags: tags.length > 0 ? tags : null,
    } as any);
    resetForm();
    onOpenChange(false);
  };

  const resetForm = () => {
    setBlockType("hook");
    setName("");
    setContent("");
    setTags([]);
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      resetForm();
    }
    onOpenChange(newOpen);
  };

  const blockTypeIcons: Record<string, any> = {
    hook: Zap,
    angle: Target,
    cta: Sparkles,
    story_element: BookOpen,
    visual_style: Palette,
  };

  const blockTypeColors: Record<string, string> = {
    hook: "from-yellow-500/20 to-orange-500/20",
    angle: "from-green-500/20 to-emerald-500/20",
    cta: "from-primary/20 to-pink-500/20",
    story_element: "from-blue-500/20 to-cyan-500/20",
    visual_style: "from-rose-500/20 to-fuchsia-500/20",
  };

  const BlockIcon = blockTypeIcons[blockType] || FileText;
  const gradientColor = blockTypeColors[blockType] || "from-gray-500/20 to-slate-500/20";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex flex-col h-[90vh] overflow-hidden max-w-3xl p-0">
        <form className="flex flex-col flex-1 min-h-0" onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
          {/* Header with gradient background */}
          <div className="shrink-0 px-6 pt-6 pb-4 bg-gradient-to-br from-yellow-500/10 via-orange-500/5 to-transparent relative">
            <div className="absolute top-4 right-8">
              <Badge className="bg-gradient-to-r from-yellow-500 to-orange-500 text-white border-0">
                <LayoutGrid className="w-3 h-3 mr-1" />
                New Block
              </Badge>
            </div>
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-yellow-500 to-orange-500 flex items-center justify-center shadow-lg">
                <BlockIcon className="w-6 h-6 text-white" />
              </div>
              <div>
                <DialogTitle className="text-xl font-bold">Create Content Block</DialogTitle>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Add reusable hooks, CTAs, angles, and story elements
                </p>
              </div>
            </div>
          </div>

          <ScrollArea className="flex-1 min-h-0">
            <div className="space-y-6 px-8 py-6">
              <Card className="border-2 border-primary/20 bg-gradient-to-br from-primary/5 to-transparent overflow-hidden">
                <div className="h-1.5 bg-gradient-to-r from-primary to-primary/60" />
                <CardContent className="pt-6 space-y-5">
                  <div className="space-y-2">
                    <Label htmlFor="blockType" className="text-base font-semibold flex items-center gap-2">
                      <Hash className="w-4 h-4" />
                      Block Type *
                    </Label>
                    <Select value={blockType} onValueChange={(value) => setBlockType(value as BlockType)}>
                      <SelectTrigger id="blockType" className="h-11">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="hook" textValue="Hook">
                          <div className="flex items-center gap-2">
                            <Zap className="w-4 h-4" />
                            Hook
                          </div>
                        </SelectItem>
                        <SelectItem value="angle" textValue="Angle">
                          <div className="flex items-center gap-2">
                            <Target className="w-4 h-4" />
                            Angle
                          </div>
                        </SelectItem>
                        <SelectItem value="cta" textValue="CTA">
                          <div className="flex items-center gap-2">
                            <Sparkles className="w-4 h-4" />
                            CTA
                          </div>
                        </SelectItem>
                        <SelectItem value="story_element" textValue="Story Element">
                          <div className="flex items-center gap-2">
                            <BookOpen className="w-4 h-4" />
                            Story Element
                          </div>
                        </SelectItem>
                        <SelectItem value="visual_style" textValue="Visual Style">
                          <div className="flex items-center gap-2">
                            <Palette className="w-4 h-4" />
                            Visual Style
                          </div>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="name" className="text-base font-semibold">Name *</Label>
                    <Input 
                      id="name" 
                      value={name} 
                      onChange={(e) => setName(e.target.value)} 
                      placeholder="e.g., Problem-Solution Hook"
                      className="h-11 text-base focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>
                </CardContent>
              </Card>

              <div className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="content" className="text-base font-semibold flex items-center gap-2">
                    <FileText className="w-4 h-4" />
                    Content
                  </Label>
                  <Textarea 
                    id="content" 
                    value={content} 
                    onChange={(e) => setContent(e.target.value)} 
                    placeholder="Enter the content for this block..."
                    className="min-h-[150px] max-h-[300px] font-mono text-sm resize-y focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-base font-semibold flex items-center gap-2">
                    <Hash className="w-4 h-4" />
                    Tags
                  </Label>
                  <EditableList
                    items={tags}
                    onChange={setTags}
                    placeholder="Add organizational tags..."
                  />
                </div>
              </div>
            </div>
          </ScrollArea>

          {/* Footer */}
          <div className="shrink-0 px-6 py-4 border-t bg-background flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              {name.trim() ? "Ready to create" : "Fill in block details"}
            </span>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={isCreating}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isCreating || !name.trim()}
                variant="cta"
                className="min-w-[140px]"
              >
                {isCreating ? (
                  <>Creating...</>
                ) : (
                  <>
                    <Check className="w-4 h-4 mr-2" />
                    Create Block
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
