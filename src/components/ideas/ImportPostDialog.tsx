import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ClipboardPaste, Download, Lightbulb, Link2, Loader2, Plus, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { persistPostImages, useImportPost } from "@/hooks/useContentTeardown";
import { ReverseEngineerBlueprintDialog } from "@/components/ideas/ReverseEngineerBlueprintDialog";
import { useSaveResearchAsIdeas } from "@/hooks/useSaveAsIdea";

const PASTE_PLATFORMS = [
  { value: "linkedin", label: "LinkedIn" },
  { value: "twitter", label: "X (Twitter)" },
  { value: "instagram", label: "Instagram" },
  { value: "tiktok", label: "TikTok" },
  { value: "youtube", label: "YouTube" },
  { value: "other", label: "Other" },
];

interface ImportPostDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "blueprint": the only action is import → reverse-engineer (Blueprints page). */
  mode?: "import" | "blueprint";
}

/**
 * Bring any post into Research, by link (scraped once via Apify) or
 * pasted by hand, and optionally go straight to reverse-engineering it.
 */
export function ImportPostDialog({ open, onOpenChange, mode = "import" }: ImportPostDialogProps) {
  const importPost = useImportPost();
  const saveAsIdeas = useSaveResearchAsIdeas();
  const [tab, setTab] = useState<"link" | "paste">("link");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [platform, setPlatform] = useState("linkedin");
  const [authorName, setAuthorName] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [imageLinks, setImageLinks] = useState<string[]>([]);
  const [imageLinkInput, setImageLinkInput] = useState("");
  const [uploading, setUploading] = useState(false);
  const [reverseIds, setReverseIds] = useState<string[] | null>(null);

  const busy = importPost.isPending || uploading;
  const canSubmit = tab === "link" ? !!url.trim() : !!text.trim() || files.length + imageLinks.length > 0;

  const reset = () => {
    setUrl("");
    setText("");
    setAuthorName("");
    setSourceUrl("");
    setFiles([]);
    setImageLinks([]);
    setImageLinkInput("");
  };

  const addImageLink = () => {
    const link = imageLinkInput.trim();
    if (!/^https?:\/\//i.test(link)) {
      toast.error("Enter a full image URL starting with http:// or https://");
      return;
    }
    if (!imageLinks.includes(link)) setImageLinks((prev) => [...prev, link]);
    setImageLinkInput("");
  };

  const submit = async (then: "none" | "reverse" | "idea") => {
    let input;
    if (tab === "link") {
      input = { url: url.trim() };
    } else {
      setUploading(true);
      try {
        const images = await persistPostImages(files, imageLinks);
        input = { text, images, platform, author_name: authorName, source_url: sourceUrl };
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
        return;
      } finally {
        setUploading(false);
      }
    }
    importPost.mutate(input, {
      onSuccess: ({ content_id, existing }) => {
        if (then !== "idea") toast.success(existing ? "Already in Research, using that post" : "Post imported to Research");
        reset();
        onOpenChange(false);
        if (then === "reverse") setReverseIds([content_id]);
        if (then === "idea") saveAsIdeas.mutate({ contentIds: [content_id], source: "post" });
      },
    });
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {mode === "blueprint" ? <Wand2 className="w-5 h-5 text-primary" /> : <Download className="w-5 h-5 text-primary" />}
              {mode === "blueprint" ? "Blueprint from a post" : "Import a post"}
            </DialogTitle>
            <DialogDescription>
              Add a post by link, or paste one you saw anywhere. Save it as an idea to write your own take, or copy
              its format into a blueprint.
            </DialogDescription>
          </DialogHeader>

          <Tabs value={tab} onValueChange={(v) => setTab(v as "link" | "paste")}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="link" className="gap-2" disabled={busy}>
                <Link2 className="w-4 h-4" /> Link
              </TabsTrigger>
              <TabsTrigger value="paste" className="gap-2" disabled={busy}>
                <ClipboardPaste className="w-4 h-4" /> Paste
              </TabsTrigger>
            </TabsList>

            <TabsContent value="link" className="space-y-2 pt-4">
              <Label htmlFor="import-post-url">Post link</Label>
              <Input
                id="import-post-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://www.linkedin.com/posts/..."
                disabled={busy}
              />
              <p className="text-xs text-muted-foreground">
                A single YouTube video, TikTok, Instagram post or reel, LinkedIn post, or X post. It's fetched once with
                your Apify key, including the transcript for videos. This takes up to a minute.
              </p>
            </TabsContent>

            <TabsContent value="paste" className="space-y-4 pt-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Platform</Label>
                  <Select value={platform} onValueChange={setPlatform} disabled={busy}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PASTE_PLATFORMS.map((p) => (
                        <SelectItem key={p.value} value={p.value}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="import-post-author">Author (optional)</Label>
                  <Input
                    id="import-post-author"
                    value={authorName}
                    onChange={(e) => setAuthorName(e.target.value)}
                    placeholder="Who posted it"
                    disabled={busy}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="import-post-text">Post text</Label>
                <Textarea
                  id="import-post-text"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Paste the full post, including line breaks. For a video, paste its script or transcript."
                  className="min-h-[180px]"
                  disabled={busy}
                />
              </div>
              <div className="space-y-2">
                <Label>Images (optional)</Label>
                <Input
                  type="file"
                  accept="image/*"
                  multiple
                  disabled={busy}
                  onChange={(e) => {
                    const picked = Array.from(e.target.files || []);
                    setFiles((prev) => [...prev, ...picked].slice(0, 10));
                    e.target.value = "";
                  }}
                />
                <div className="flex gap-2">
                  <Input
                    value={imageLinkInput}
                    onChange={(e) => setImageLinkInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addImageLink();
                      }
                    }}
                    placeholder="Or paste an image URL"
                    disabled={busy}
                  />
                  <Button type="button" variant="outline" onClick={addImageLink} disabled={busy || !imageLinkInput.trim()}>
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>
                {files.length + imageLinks.length > 0 && (
                  <ul className="space-y-1 text-sm">
                    {files.map((f, i) => (
                      <li key={`f-${i}`} className="flex items-center justify-between gap-2 rounded bg-muted/40 px-2 py-1">
                        <span className="truncate">{f.name}</span>
                        <Button type="button" variant="ghost" size="icon" className="h-6 w-6" disabled={busy}
                          onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </li>
                    ))}
                    {imageLinks.map((l) => (
                      <li key={l} className="flex items-center justify-between gap-2 rounded bg-muted/40 px-2 py-1">
                        <span className="truncate">{l}</span>
                        <Button type="button" variant="ghost" size="icon" className="h-6 w-6" disabled={busy}
                          onClick={() => setImageLinks((prev) => prev.filter((x) => x !== l))}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-xs text-muted-foreground">
                  Carousel slides or the post image. The analysis reads the visual format from them (up to 4 are used).
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="import-post-source">Original link (optional)</Label>
                <Input
                  id="import-post-source"
                  value={sourceUrl}
                  onChange={(e) => setSourceUrl(e.target.value)}
                  placeholder="https://..."
                  disabled={busy}
                />
              </div>
            </TabsContent>
          </Tabs>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            {mode === "import" ? (
              <>
                <Button variant="outline" onClick={() => submit("reverse")} disabled={busy || !canSubmit}>
                  <Wand2 className="w-4 h-4 mr-2" />
                  Import & copy format
                </Button>
                <Button variant="cta" onClick={() => submit("idea")} disabled={busy || !canSubmit}>
                  {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Lightbulb className="w-4 h-4 mr-2" />}
                  Import & save as idea
                </Button>
              </>
            ) : (
              <Button variant="cta" onClick={() => submit("reverse")} disabled={busy || !canSubmit}>
                {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Wand2 className="w-4 h-4 mr-2" />}
                Continue
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ReverseEngineerBlueprintDialog
        contentIds={reverseIds || []}
        open={!!reverseIds}
        onOpenChange={(next) => !next && setReverseIds(null)}
      />
    </>
  );
}
