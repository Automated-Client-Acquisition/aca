import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { X, Plus, Upload, Wand2, Link, Loader2, GripVertical } from "lucide-react";
import { useMediaUpload } from "@/hooks/useMediaUpload";
import { useGenerateImage } from "@/hooks/useGenerateImage";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface MultiImageGalleryProps {
  images: string[];
  onUpdateImages: (images: string[]) => void;
  outputId?: string; // Optional for AI generation
  className?: string;
}

export function MultiImageGallery({ images, onUpdateImages, outputId, className }: MultiImageGalleryProps) {
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [imageUrl, setImageUrl] = useState("");
  const [aiPrompt, setAiPrompt] = useState("");
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  const { uploadMedia, isUploading, progress } = useMediaUpload();
  const generateImage = useGenerateImage();

  const handleRemoveImage = (index: number) => {
    console.log('[MultiImageGallery] handleRemoveImage called', { index, currentImages: images });
    const newImages = images.filter((_, i) => i !== index);
    console.log('[MultiImageGallery] new images after filter', { newImages });
    onUpdateImages(newImages);
  };

  const handleAddImage = (newImageUrl: string) => {
    onUpdateImages([...images, newImageUrl]);
    setIsAddDialogOpen(false);
    setUploadedFile(null);
    setImageUrl("");
    setAiPrompt("");
  };

  const handleFileUpload = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('Please upload an image file');
      return;
    }

    const url = await uploadMedia(file);
    if (url) {
      handleAddImage(url);
      toast.success('Image uploaded successfully');
    }
  };

  const handleUrlSubmit = () => {
    if (!imageUrl.trim()) return;
    handleAddImage(imageUrl);
    toast.success('Image added successfully');
  };

  const handleAIGenerate = async () => {
    if (!aiPrompt.trim() || !outputId) return;
    
    const result = await generateImage.mutateAsync({ outputId, prompt: aiPrompt });
    if (result) {
      handleAddImage(result);
      toast.success('Image generated successfully');
    }
  };

  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;

    const newImages = [...images];
    const draggedImage = newImages[draggedIndex];
    newImages.splice(draggedIndex, 1);
    newImages.splice(index, 0, draggedImage);
    
    onUpdateImages(newImages);
    setDraggedIndex(index);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0 && files[0].type.startsWith('image/')) {
      setUploadedFile(files[0]);
      handleFileUpload(files[0]);
    }
  };

  return (
    <>
      <div className={cn("space-y-3", className)}>
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">Images {images.length > 0 && `(${images.length})`}</Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setIsAddDialogOpen(true)}
            className="h-8 gap-2"
          >
            <Plus className="h-3 w-3" />
            Add Image
          </Button>
        </div>

        {images.length > 0 && (
          <div className="grid grid-cols-3 gap-3">
            {images.map((imageUrl, index) => (
              <div
                key={index}
                draggable
                onDragStart={() => handleDragStart(index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragEnd={handleDragEnd}
                className={cn(
                  "group relative aspect-square rounded-lg border bg-muted overflow-hidden cursor-move",
                  draggedIndex === index && "opacity-50"
                )}
              >
                <img
                  src={imageUrl}
                  alt={`Image ${index + 1}`}
                  className="w-full h-full object-cover"
                />
                <div
                  className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2"
                  onMouseDown={(e) => e.stopPropagation()}
                  onDragStart={(e) => e.stopPropagation()}
                >
                  <GripVertical className="h-4 w-4 text-white pointer-events-none" />
                  <Button
                    type="button"
                    variant="destructive"
                    size="icon"
                    className="h-8 w-8"
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      handleRemoveImage(index);
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                {index === 0 && (
                  <div className="absolute top-2 left-2 bg-primary text-primary-foreground text-xs px-2 py-1 rounded">
                    Primary
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {images.length === 0 && (
          <div className="border-2 border-dashed rounded-lg p-8 text-center text-muted-foreground">
            <p className="text-sm">No images added yet</p>
            <p className="text-xs mt-1">Click "Add Image" to upload or generate images</p>
          </div>
        )}
      </div>

      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add Image</DialogTitle>
          </DialogHeader>

          <Tabs defaultValue="upload" className="w-full">
            <TabsList className={cn("grid w-full", outputId ? "grid-cols-3" : "grid-cols-2")}>
              <TabsTrigger value="upload">
                <Upload className="h-4 w-4 mr-2" />
                Upload
              </TabsTrigger>
              {outputId && (
                <TabsTrigger value="ai">
                  <Wand2 className="h-4 w-4 mr-2" />
                  AI Generate
                </TabsTrigger>
              )}
              <TabsTrigger value="url">
                <Link className="h-4 w-4 mr-2" />
                URL
              </TabsTrigger>
            </TabsList>

            <TabsContent value="upload" className="space-y-4">
              <div
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleFileDrop}
                className={cn(
                  "border-2 border-dashed rounded-lg p-8 text-center transition-colors",
                  isDragging ? "border-primary bg-primary/5" : "border-border"
                )}
              >
                {uploadedFile ? (
                  <div className="space-y-4">
                    <div className="relative w-full max-w-md mx-auto aspect-video rounded-lg overflow-hidden">
                      <img
                        src={URL.createObjectURL(uploadedFile)}
                        alt="Preview"
                        className="w-full h-full object-cover"
                      />
                    </div>
                    {isUploading && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Uploading... {progress.percentage}%
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <Upload className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground mb-2">
                      Drag and drop an image here, or click to browse
                    </p>
                    <Input
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          setUploadedFile(file);
                          handleFileUpload(file);
                        }
                      }}
                      className="max-w-xs mx-auto"
                    />
                  </>
                )}
              </div>
            </TabsContent>

            {outputId && (
              <TabsContent value="ai" className="space-y-4">
                <div className="space-y-3">
                  <Label htmlFor="ai-prompt">Image Description</Label>
                  <Textarea
                    id="ai-prompt"
                    value={aiPrompt}
                    onChange={(e) => setAiPrompt(e.target.value)}
                    placeholder="Describe the image you want to generate..."
                    rows={4}
                    className="resize-none"
                  />
                  <Button
                    onClick={handleAIGenerate}
                    disabled={!aiPrompt.trim() || generateImage.isPending}
                    className="w-full"
                  >
                    {generateImage.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Generating...
                      </>
                    ) : (
                      <>
                        <Wand2 className="h-4 w-4 mr-2" />
                        Generate Image
                      </>
                    )}
                  </Button>
                </div>
              </TabsContent>
            )}

            <TabsContent value="url" className="space-y-4">
              <div className="space-y-3">
                <Label htmlFor="image-url">Image URL</Label>
                <Input
                  id="image-url"
                  type="url"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  placeholder="https://example.com/image.jpg"
                />
                <Button
                  variant="cta"
                  onClick={handleUrlSubmit}
                  disabled={!imageUrl.trim()}
                  className="w-full"
                >
                  Add Image
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </>
  );
}
