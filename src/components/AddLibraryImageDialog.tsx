import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useEffect, useState } from "react";
import { useLibraryImages } from "@/hooks/useLibraryImages";
import { supabase } from "@/integrations/supabase/client";
import { invokeEdgeFunction } from "@/lib/supabase-functions";
import { ImagePlus, Trash2, Image as ImageIcon, Sparkles, Link2, Plus } from "lucide-react";
import { toast } from "sonner";
import { EditableList } from "./EditableList";

interface AddLibraryImageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Prefill values, applied each time the dialog opens (e.g. saving a scraped post's image). */
  initialName?: string;
  initialTags?: string[];
  initialImageUrls?: string[];
}

interface SaveRemoteImagesResponse {
  results: { sourceUrl: string; url?: string; error?: string }[];
}

export function AddLibraryImageDialog({
  open,
  onOpenChange,
  initialName,
  initialTags,
  initialImageUrls,
}: AddLibraryImageDialogProps) {
  const { createLibraryImage, isCreating } = useLibraryImages();

  const [name, setName] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  // Remote links are copied into storage on save — CDN URLs from scraped posts expire.
  const [remoteUrls, setRemoteUrls] = useState<string[]>([]);
  const [urlInput, setUrlInput] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(initialName ?? "");
    setTags(initialTags ?? []);
    setRemoteUrls(initialImageUrls ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const addRemoteUrl = () => {
    const url = urlInput.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) {
      toast.error("Enter a full image URL starting with http:// or https://");
      return;
    }
    if (!remoteUrls.includes(url)) setRemoteUrls(prev => [...prev, url]);
    setUrlInput("");
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      setImageFiles(prev => [...prev, ...files]);

      files.forEach(file => {
        const reader = new FileReader();
        reader.onloadend = () => {
          setImagePreviews(prev => [...prev, reader.result as string]);
        };
        reader.readAsDataURL(file);
      });
    }
  };

  const removeImage = (index: number) => {
    setImageFiles(prev => prev.filter((_, i) => i !== index));
    setImagePreviews(prev => prev.filter((_, i) => i !== index));
  };

  const resetForm = () => {
    setName("");
    setTags([]);
    setImageFiles([]);
    setImagePreviews([]);
    setRemoteUrls([]);
    setUrlInput("");
  };

  const totalImages = imageFiles.length + remoteUrls.length;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (totalImages === 0) {
      toast.error("Add at least one image");
      return;
    }

    setIsSaving(true);
    try {
      const imageUrls: string[] = [];
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        for (const imageFile of imageFiles) {
          const fileExt = imageFile.name.split('.').pop();
          const fileName = `${user.id}/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;

          const { error: uploadError } = await supabase.storage
            .from('library-images')
            .upload(fileName, imageFile);

          if (uploadError) {
            toast.error(`Failed to upload image: ${imageFile.name}`);
            throw uploadError;
          }

          const { data: { publicUrl } } = supabase.storage
            .from('library-images')
            .getPublicUrl(fileName);

          imageUrls.push(publicUrl);
        }
      }

      if (remoteUrls.length > 0) {
        const { results } = await invokeEdgeFunction<SaveRemoteImagesResponse>("save-remote-images", {
          urls: remoteUrls,
        });
        const failed = results.filter(r => !r.url);
        imageUrls.push(...results.flatMap(r => (r.url ? [r.url] : [])));
        if (failed.length > 0) {
          toast.warning(
            `${failed.length} image link${failed.length !== 1 ? "s" : ""} couldn't be saved: ${failed[0].error}`
          );
        }
      }

      if (imageUrls.length === 0) {
        toast.error("None of the images could be saved");
        return;
      }

      createLibraryImage({
        name,
        images: imageUrls,
        tags,
      });
      onOpenChange(false);
      resetForm();
    } catch (error) {
      console.error('Error adding library images:', error);
      toast.error("Failed to add images. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) resetForm();
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="flex flex-col max-h-[90vh] overflow-hidden max-w-2xl p-0">
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          {/* Header with gradient background */}
          <div className="shrink-0 px-6 pt-6 pb-4 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent relative">
            <div className="absolute top-4 right-8">
              <Badge className="bg-gradient-aca text-white border-0">
                <ImageIcon className="w-3 h-3 mr-1" />
                New Images
              </Badge>
            </div>
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-gradient-aca flex items-center justify-center shadow-lg">
                <ImageIcon className="w-6 h-6 text-white" />
              </div>
              <div>
                <DialogTitle className="text-xl font-bold">Add Images</DialogTitle>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Upload standalone pictures to use as reference images
                </p>
              </div>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-8 py-6 space-y-5">
            <div className="space-y-2">
              <Label htmlFor="name" className="text-base font-semibold flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-primary" />
                Name *
              </Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Q4 Campaign Photos"
                required
                className="h-11 text-base focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            <div className="space-y-3">
              <Label className="text-base font-semibold flex items-center gap-2">
                <ImagePlus className="w-4 h-4 text-primary" />
                Images *
              </Label>
              <Input
                id="library-image-upload"
                type="file"
                accept="image/*"
                multiple
                onChange={handleImageChange}
                className="cursor-pointer h-11"
              />
              {imagePreviews.length > 0 && (
                <div className="grid grid-cols-3 gap-4 p-4 bg-muted/30 rounded-lg">
                  {imagePreviews.map((preview, index) => (
                    <div key={index} className="relative group">
                      <div className="relative w-full h-32 rounded-lg overflow-hidden border-2 border-primary/20 shadow-sm">
                        <img
                          src={preview}
                          alt={`Preview ${index + 1}`}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                      </div>
                      <Button
                        type="button"
                        variant="destructive"
                        size="icon"
                        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity shadow-lg"
                        onClick={() => removeImage(index)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addRemoteUrl();
                      }
                    }}
                    placeholder="Or paste an image URL"
                    className="h-11 pl-9"
                  />
                </div>
                <Button type="button" variant="outline" className="h-11" onClick={addRemoteUrl} disabled={!urlInput.trim()}>
                  <Plus className="w-4 h-4 mr-1" />
                  Add
                </Button>
              </div>
              {remoteUrls.length > 0 && (
                <div className="grid grid-cols-3 gap-4 p-4 bg-muted/30 rounded-lg">
                  {remoteUrls.map((url) => (
                    <div key={url} className="relative group">
                      <div className="relative w-full h-32 rounded-lg overflow-hidden border-2 border-primary/20 shadow-sm bg-muted">
                        <img
                          src={url}
                          alt=""
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                      </div>
                      <Button
                        type="button"
                        variant="destructive"
                        size="icon"
                        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity shadow-lg"
                        onClick={() => setRemoteUrls(prev => prev.filter(u => u !== url))}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-sm text-muted-foreground">
                Add several pictures at once — they'll be selectable together as reference images.
                Linked images are copied into your library so they don't expire.
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-base font-semibold">Tags</Label>
              <EditableList
                items={tags}
                onChange={setTags}
                placeholder="Add tags such as editorial, studio, or founder..."
              />
              <p className="text-sm text-muted-foreground">
                Tags help you find this reference set. Autopilot only uses references you explicitly select.
              </p>
            </div>
          </div>

          {/* Footer */}
          <div className="shrink-0 px-6 py-4 border-t bg-background flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              {totalImages > 0 ? `${totalImages} image${totalImages !== 1 ? 's' : ''} selected` : "Add a name and at least one image"}
            </span>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  resetForm();
                  onOpenChange(false);
                }}
                disabled={isCreating || isSaving}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isCreating || isSaving || !name.trim() || totalImages === 0}
                variant="cta"
                className="min-w-[140px]"
              >
                {isCreating || isSaving ? (
                  <>Saving...</>
                ) : (
                  <>
                    <Check className="w-4 h-4 mr-2" />
                    Add Images
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
