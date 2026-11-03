import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Loader2, Sparkles, Folder, FolderOpen, Plus, Check, X, ChevronDown, Link, FileText } from "lucide-react";
import { useIdeas } from "@/hooks/useIdeas";
import { useBrandVoices } from "@/hooks/useBrandVoices";
import { useProducts } from "@/hooks/useProducts";
import { useBlocks } from "@/hooks/useBlocks";
import { useIdeaFolders } from "@/hooks/useIdeaFolders";
import { useIdeaFoldersCRUD } from "@/hooks/useIdeaFoldersCRUD";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { FeedTargetSelect } from "@/components/ideas/FeedTargetSelect";
import { NO_FEED, findFeedOption } from "@/lib/idea-feeds";
import { useAssignIdeasToAutopilot, useFeedOptions } from "@/hooks/useIdeaFeeds";
import { useBrandKit } from "@/hooks/useBrandKit";

// Preset colors for folders
const FOLDER_COLORS = [
  "#6366f1", // Indigo (default)
  "#8b5cf6", // Violet
  "#ec4899", // Pink
  "#ef4444", // Red
  "#f97316", // Orange
  "#eab308", // Yellow
  "#22c55e", // Green
  "#14b8a6", // Teal
  "#0ea5e9", // Sky
  "#6b7280", // Gray
];

interface AddIdeaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Preselect this autopilot as the one that posts the new ideas. */
  autopilotId?: string | null;
}

export function AddIdeaDialog({ open, onOpenChange, autopilotId }: AddIdeaDialogProps) {
  const [title, setTitle] = useState("");
  const [freeText, setFreeText] = useState("");
  const [sourceUrls, setSourceUrls] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [brandVoiceId, setBrandVoiceId] = useState<string>("");
  const [productId, setProductId] = useState<string>("");
  const [contentAngleId, setContentAngleId] = useState<string>("");
  const [folderId, setFolderId] = useState<string>("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderColor, setNewFolderColor] = useState(FOLDER_COLORS[0]);
  const [feedKey, setFeedKey] = useState(NO_FEED);

  const { createIdea } = useIdeas();
  const { options: feedOptions } = useFeedOptions();
  const assignToAutopilot = useAssignIdeasToAutopilot();
  const { resolve: resolveBrandKit } = useBrandKit();
  // What generate-content-idea falls back to when nothing is picked.
  const brandKitDefault = (kind: "brand" | "product") => {
    const r = resolveBrandKit(kind);
    return r ? `Default: ${r.element.name}` : "None";
  };
  const { brandVoices } = useBrandVoices();
  const { products } = useProducts();
  const { blocks } = useBlocks('angle');
  const { data: folders = [] } = useIdeaFolders();
  const { createFolder, isCreating: isCreatingFolder } = useIdeaFoldersCRUD();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    setIsGenerating(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const numIdeas = parseInt(quantity);
      const createdIds: string[] = [];

      // Create all ideas immediately with generation flag
      for (let i = 0; i < numIdeas; i++) {
        const newIdea = await createIdea({
          title: title.trim(),
          free_text: freeText.trim() || null,
          source_urls: sourceUrls.trim() || null,
          brand_voice_id: brandVoiceId || null,
          product_id: productId || null,
          content_angle_id: contentAngleId || null,
          folder_id: folderId || null,
        });
        createdIds.push(newIdea.id);

        // Mark as generating
        await supabase
          .from('content_ideas')
          .update({ generation_in_progress: true })
          .eq('id', newIdea.id);

        // Trigger async generation — must consume the stream to keep the connection
        // alive long enough for the edge function to write results to the DB.
        fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-content-idea`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${session.access_token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              idea_id: newIdea.id,
              title: title.trim(),
              brand_voice_id: brandVoiceId || null,
              product_id: productId || null,
              content_angle_id: contentAngleId || null,
              generate_unique: numIdeas > 1,
            }),
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
        }).catch(async (error) => {
          console.error('Error triggering generation:', error);
          await supabase
            .from('content_ideas')
            .update({ generation_in_progress: false })
            .eq('id', newIdea.id);
        });
      }

      toast.success(
        `Created ${numIdeas} ${numIdeas === 1 ? 'idea' : 'ideas'}. AI generation in progress...`,
        { duration: 4000 }
      );

      const feed = findFeedOption(feedOptions, feedKey);
      if (feed && createdIds.length > 0) {
        assignToAutopilot.mutate({ ideaIds: createdIds, target: feed.target });
      }

      handleClose();
    } catch (error) {
      console.error('Error:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to create ideas');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleClose = () => {
    setTitle("");
    setFreeText("");
    setSourceUrls("");
    setQuantity("1");
    setBrandVoiceId("");
    setProductId("");
    setContentAngleId("");
    setFolderId("");
    setFeedKey(NO_FEED);
    setShowCreateFolder(false);
    setNewFolderName("");
    setNewFolderColor(FOLDER_COLORS[0]);
    onOpenChange(false);
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    try {
      const newFolder = await createFolder.mutateAsync({
        name: newFolderName,
        color: newFolderColor,
      });
      setShowCreateFolder(false);
      setNewFolderName("");
      setNewFolderColor(FOLDER_COLORS[0]);
      // Auto-select the new folder
      if (newFolder?.id) {
        setFolderId(newFolder.id);
      }
    } catch (error) {
      // Error handled in hook
    }
  };


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl h-[85vh] flex flex-col p-0">
        <div className="shrink-0 p-6 pb-4 border-b">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" />
              Quick Start: Generate Ideas with AI
            </DialogTitle>
            <DialogDescription>
              Enter a topic to create ideas. AI will generate hooks, CTAs, and frameworks in the background.
            </DialogDescription>
          </DialogHeader>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <ScrollArea className="h-[calc(85vh-220px)] px-6">
            <div className="space-y-5 py-4">
              {/* Topic + Quantity — always visible */}
              <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-primary/10">
                <CardContent className="pt-6 space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="title">Topic, Keyword, or URL *</Label>
                    <Input
                      id="title"
                      placeholder="e.g., 'viral content psychology' or paste article URL"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      required
                      disabled={isGenerating}
                      maxLength={200}
                      className="bg-background"
                    />
                  </div>

                  <div className="flex gap-3 items-end">
                    <div className="space-y-2 w-48">
                      <Label htmlFor="quantity">How many?</Label>
                      <Select
                        value={quantity}
                        onValueChange={setQuantity}
                        disabled={isGenerating}
                      >
                        <SelectTrigger id="quantity" className="bg-background">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {[1, 2, 3, 4, 5, 10].map((num) => (
                            <SelectItem key={num} value={num.toString()}>
                              {num} {num === 1 ? 'idea' : 'ideas'}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <p className="text-[11px] text-muted-foreground pb-2.5">
                      AI generates hooks, CTAs, and frameworks in the background.
                    </p>
                  </div>

                  <FeedTargetSelect id="add-idea-feed" value={feedKey} onChange={setFeedKey} autopilotId={autopilotId} />
                </CardContent>
              </Card>

              {/* Collapsible: Free Text + URLs */}
              <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
                <CollapsibleTrigger className="flex items-center gap-2 w-full text-sm font-medium text-muted-foreground hover:text-foreground transition-colors py-1">
                  <ChevronDown className={cn("w-4 h-4 transition-transform", advancedOpen && "rotate-180")} />
                  Free Text & Reference URLs
                  {(freeText || sourceUrls) && (
                    <span className="ml-auto flex items-center gap-1.5">
                      {freeText && <FileText className="w-3.5 h-3.5 text-primary" />}
                      {sourceUrls && <Link className="w-3.5 h-3.5 text-primary" />}
                    </span>
                  )}
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-3 space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="free-text" className="text-xs">Free Text</Label>
                    <Textarea
                      id="free-text"
                      placeholder="Custom text to pass verbatim into blueprints via {{idea_text}}..."
                      value={freeText}
                      onChange={(e) => setFreeText(e.target.value)}
                      disabled={isGenerating}
                      className="min-h-[70px] resize-y text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="source-urls" className="text-xs">Reference URLs</Label>
                    <Textarea
                      id="source-urls"
                      placeholder="Paste one or more URLs, one per line — available via {{idea_urls}}"
                      value={sourceUrls}
                      onChange={(e) => setSourceUrls(e.target.value)}
                      disabled={isGenerating}
                      className="min-h-[56px] resize-y text-sm"
                    />
                  </div>
                </CollapsibleContent>
              </Collapsible>

              <Separator />

              {/* Library Elements */}
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-medium">Brand Kit</h3>
                  <p className="text-xs text-muted-foreground">Leave empty to use your Brand Kit defaults.</p>
                </div>

                {/* Brand Voice */}
                <div className="space-y-2">
                  <Label htmlFor="brand-voice">Brand Voice</Label>
                  <Select
                    value={brandVoiceId || undefined}
                    onValueChange={(value) => setBrandVoiceId(value)}
                    disabled={isGenerating}
                  >
                    <SelectTrigger id="brand-voice">
                      <SelectValue placeholder={brandKitDefault("brand")} />
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

                {/* Product */}
                <div className="space-y-2">
                  <Label htmlFor="product">Product</Label>
                  <Select
                    value={productId || undefined}
                    onValueChange={(value) => setProductId(value)}
                    disabled={isGenerating}
                  >
                    <SelectTrigger id="product">
                      <SelectValue placeholder={brandKitDefault("product")} />
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

                {/* Content Angle */}
                <div className="space-y-2">
                  <Label htmlFor="content-angle">Content Angle</Label>
                  <Select
                    value={contentAngleId || undefined}
                    onValueChange={(value) => setContentAngleId(value)}
                    disabled={isGenerating}
                  >
                    <SelectTrigger id="content-angle">
                      <SelectValue placeholder="Select content angle (optional)" />
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

                {/* Folder */}
                <div className="space-y-3">
                  <Label>Folder</Label>

                  {/* Folder chips */}
                  <div className="flex flex-wrap gap-2">
                    {/* No folder option */}
                    <button
                      type="button"
                      onClick={() => setFolderId("")}
                      disabled={isGenerating}
                      className={cn(
                        "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all",
                        "border hover:bg-accent/50",
                        !folderId
                          ? "bg-accent border-primary/50 ring-1 ring-primary/20"
                          : "bg-background border-border"
                      )}
                    >
                      <Folder className="w-3.5 h-3.5 text-muted-foreground" />
                      <span>No folder</span>
                    </button>

                    {/* Existing folders */}
                    {folders.map((folder) => (
                      <button
                        key={folder.id}
                        type="button"
                        onClick={() => setFolderId(folder.id)}
                        disabled={isGenerating}
                        className={cn(
                          "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all",
                          "border hover:bg-accent/50",
                          folderId === folder.id
                            ? "bg-accent border-primary/50 ring-1 ring-primary/20"
                            : "bg-background border-border"
                        )}
                      >
                        <div
                          className="w-3 h-3 rounded-full shrink-0"
                          style={{ backgroundColor: folder.color }}
                        />
                        <span className="truncate max-w-[120px]">{folder.name}</span>
                        {folderId === folder.id && (
                          <Check className="w-3.5 h-3.5 text-primary" />
                        )}
                      </button>
                    ))}

                    {/* Create new folder button */}
                    {!showCreateFolder && (
                      <button
                        type="button"
                        onClick={() => setShowCreateFolder(true)}
                        disabled={isGenerating}
                        className={cn(
                          "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all",
                          "border border-dashed border-muted-foreground/40 hover:border-primary hover:bg-accent/50",
                          "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>New folder</span>
                      </button>
                    )}
                  </div>

                  {/* Inline folder creation */}
                  {showCreateFolder && (
                    <Card className="border-dashed">
                      <CardContent className="p-3 space-y-3">
                        <div className="flex items-center gap-2">
                          <FolderOpen className="w-4 h-4 text-muted-foreground" />
                          <span className="text-sm font-medium">Create new folder</span>
                        </div>

                        <Input
                          placeholder="Folder name"
                          value={newFolderName}
                          onChange={(e) => setNewFolderName(e.target.value)}
                          disabled={isCreatingFolder}
                          className="h-8"
                          autoFocus
                        />

                        {/* Color picker */}
                        <div className="space-y-1.5">
                          <span className="text-xs text-muted-foreground">Color</span>
                          <div className="flex flex-wrap gap-1.5">
                            {FOLDER_COLORS.map((color) => (
                              <button
                                key={color}
                                type="button"
                                onClick={() => setNewFolderColor(color)}
                                disabled={isCreatingFolder}
                                className={cn(
                                  "w-6 h-6 rounded-full transition-all",
                                  newFolderColor === color
                                    ? "ring-2 ring-offset-2 ring-primary"
                                    : "hover:scale-110"
                                )}
                                style={{ backgroundColor: color }}
                              />
                            ))}
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-2 pt-1">
                          <Button
                            type="button"
                            size="sm"
                            onClick={handleCreateFolder}
                            disabled={!newFolderName.trim() || isCreatingFolder}
                            className="h-7 text-xs"
                          >
                            {isCreatingFolder ? (
                              <>
                                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                Creating...
                              </>
                            ) : (
                              <>
                                <Check className="w-3 h-3 mr-1" />
                                Create
                              </>
                            )}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setShowCreateFolder(false);
                              setNewFolderName("");
                              setNewFolderColor(FOLDER_COLORS[0]);
                            }}
                            disabled={isCreatingFolder}
                            className="h-7 text-xs"
                          >
                            <X className="w-3 h-3 mr-1" />
                            Cancel
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </div>
              </div>
            </div>
          </ScrollArea>

          {/* Actions */}
          <div className="shrink-0 flex gap-3 justify-end p-6 pt-4 border-t bg-background">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={isGenerating}
            >
              Cancel
            </Button>
            <Button variant="cta" type="submit" disabled={isGenerating || !title.trim()}>
              {isGenerating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-2" />
                  Create {quantity !== "1" ? `${quantity} Ideas` : 'Idea'}
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
