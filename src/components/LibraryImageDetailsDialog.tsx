import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useState, useEffect } from "react";
import { Trash2, ImagePlus, Save, Calendar } from "lucide-react";
import { formatDate } from "@/lib/tableUtils";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Lightbox } from "@/components/ui/lightbox";
import type { LibraryImage } from "@/hooks/useLibraryImages";
import { EditableList } from "./EditableList";

interface LibraryImageDetailsDialogProps {
  libraryImage: LibraryImage | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (id: string, updates: Partial<LibraryImage>) => void;
  onDelete: (id: string) => void;
  isUpdating: boolean;
}

export function LibraryImageDetailsDialog({ libraryImage, open, onOpenChange, onSave, onDelete, isUpdating }: LibraryImageDetailsDialogProps) {
  const [name, setName] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [existingImages, setExistingImages] = useState<string[]>([]);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  useEffect(() => {
    if (!open || !libraryImage) {
      setName("");
      setTags([]);
      setExistingImages([]);
      setImageFiles([]);
      setImagePreviews([]);
    } else {
      setName(libraryImage.name);
      setTags(libraryImage.tags || []);
      setExistingImages(libraryImage.images || []);
    }
  }, [open, libraryImage?.id]);

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

  const removeExistingImage = (index: number) => {
    setExistingImages(prev => prev.filter((_, i) => i !== index));
  };

  const removeNewImage = (index: number) => {
    setImageFiles(prev => prev.filter((_, i) => i !== index));
    setImagePreviews(prev => prev.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    if (!libraryImage) return;

    try {
      let finalImages = existingImages;

      if (imageFiles.length > 0) {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const newImageUrls: string[] = [];
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

            newImageUrls.push(publicUrl);
          }
          finalImages = [...existingImages, ...newImageUrls];
        }
      }

      onSave(libraryImage.id, { name, images: finalImages, tags });
      setImageFiles([]);
      setImagePreviews([]);
      onOpenChange(false);
    } catch (error) {
      console.error('Error saving library images:', error);
      toast.error("Failed to save. Please try again.");
    }
  };

  const handleDelete = () => {
    if (!libraryImage) return;
    onDelete(libraryImage.id);
    setDeleteDialogOpen(false);
    onOpenChange(false);
  };

  if (!libraryImage) return null;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{libraryImage.name}</DialogTitle>
          </DialogHeader>

          <div className="space-y-5">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Calendar className="h-3.5 w-3.5" />
              Added {formatDate(libraryImage.created_at)}
            </div>

            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>

            <div className="space-y-3">
              <Label className="flex items-center gap-2">
                <ImagePlus className="w-4 h-4" />
                Images
              </Label>

              {existingImages.length > 0 && (
                <div className="grid grid-cols-3 gap-3">
                  {existingImages.map((url, index) => (
                    <div key={url} className="relative group">
                      <button
                        type="button"
                        className="relative w-full h-28 rounded-lg overflow-hidden border-2 border-border shadow-sm"
                        onClick={() => setPreviewImage(url)}
                      >
                        <img src={url} alt="" className="w-full h-full object-cover" />
                      </button>
                      <Button
                        type="button"
                        variant="destructive"
                        size="icon"
                        className="absolute top-1.5 right-1.5 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => removeExistingImage(index)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              {imagePreviews.length > 0 && (
                <div className="grid grid-cols-3 gap-3">
                  {imagePreviews.map((preview, index) => (
                    <div key={index} className="relative group">
                      <div className="relative w-full h-28 rounded-lg overflow-hidden border-2 border-primary/30 shadow-sm">
                        <img src={preview} alt="" className="w-full h-full object-cover" />
                      </div>
                      <Button
                        type="button"
                        variant="destructive"
                        size="icon"
                        className="absolute top-1.5 right-1.5 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => removeNewImage(index)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              <Input type="file" accept="image/*" multiple onChange={handleImageChange} className="cursor-pointer" />
            </div>

            <div className="space-y-2">
              <Label>Tags</Label>
              <EditableList
                items={tags}
                onChange={setTags}
                placeholder="Add tags such as editorial, studio, or founder..."
              />
              <p className="text-xs text-muted-foreground">
                Tags organize reference sets; they do not automatically add images to a generation.
              </p>
            </div>

            <div className="flex items-center justify-between pt-2 border-t">
              <Button
                type="button"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={() => setDeleteDialogOpen(true)}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete
              </Button>
              <Button
                type="button"
                variant="cta"
                onClick={handleSave}
                disabled={isUpdating || !name.trim() || (existingImages.length === 0 && imageFiles.length === 0)}
              >
                <Save className="w-4 h-4 mr-2" />
                {isUpdating ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Images</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete "{libraryImage.name}" and remove it from any blueprint that references it. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Lightbox
        src={previewImage}
        open={previewImage !== null}
        onOpenChange={(open) => !open && setPreviewImage(null)}
      />
    </>
  );
}
