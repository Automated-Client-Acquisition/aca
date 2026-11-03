import { useState, useRef, useCallback } from "react";
import { MessageSquare, X, Upload, Loader2, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

const FEEDBACK_TOPICS = [
  { value: "bug", label: "Bug Report" },
  { value: "feature", label: "Feature Request" },
  { value: "improvement", label: "Improvement Suggestion" },
  { value: "question", label: "Question" },
  { value: "other", label: "Other" },
];

export function FeedbackPopover() {
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState("");
  const [feedback, setFeedback] = useState("");
  const [images, setImages] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const { user } = useAuth();

  const handleFileChange = useCallback((files: FileList | null) => {
    if (!files) return;

    const newFiles: File[] = [];
    const newPreviews: string[] = [];

    Array.from(files).forEach((file) => {
      if (file.type.startsWith("image/")) {
        if (images.length + newFiles.length < 3) {
          newFiles.push(file);
          newPreviews.push(URL.createObjectURL(file));
        }
      }
    });

    setImages((prev) => [...prev, ...newFiles]);
    setImagePreviews((prev) => [...prev, ...newPreviews]);
  }, [images.length]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      handleFileChange(e.dataTransfer.files);
    },
    [handleFileChange]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const removeImage = (index: number) => {
    URL.revokeObjectURL(imagePreviews[index]);
    setImages((prev) => prev.filter((_, i) => i !== index));
    setImagePreviews((prev) => prev.filter((_, i) => i !== index));
  };

  const resetForm = () => {
    setTopic("");
    setFeedback("");
    imagePreviews.forEach((url) => URL.revokeObjectURL(url));
    setImages([]);
    setImagePreviews([]);
  };

  const handleSubmit = async () => {
    if (!topic || !feedback.trim()) {
      toast({
        title: "Missing information",
        description: "Please select a topic and enter your feedback.",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      // Convert images to base64
      const imageData: string[] = [];
      for (const image of images) {
        const reader = new FileReader();
        const base64 = await new Promise<string>((resolve) => {
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(image);
        });
        imageData.push(base64);
      }

      const { error } = await supabase.functions.invoke("send-feedback", {
        body: {
          topic,
          feedback,
          images: imageData,
          userEmail: user?.email,
          userId: user?.id,
          url: window.location.href,
        },
      });

      if (error) throw error;

      // Show success state
      setIsSuccess(true);

      // Close after delay
      setTimeout(() => {
        setOpen(false);
        // Reset after popover closes
        setTimeout(() => {
          resetForm();
          setIsSuccess(false);
        }, 200);
      }, 1500);
    } catch (error) {
      console.error("Error sending feedback:", error);
      toast({
        title: "Failed to send feedback",
        description: "Please try again later.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <MessageSquare className="w-4 h-4" />
          Feedback
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="end">
        {isSuccess ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <CheckCircle2 className="w-12 h-12 text-green-500 mb-3" />
            <h3 className="font-semibold text-lg">Thank you!</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Your feedback has been sent.
            </p>
          </div>
        ) : (
        <div className="space-y-4">
          <Select value={topic} onValueChange={setTopic}>
            <SelectTrigger>
              <SelectValue placeholder="Select a topic..." />
            </SelectTrigger>
            <SelectContent>
              {FEEDBACK_TOPICS.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Textarea
            placeholder="Your feedback..."
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            className="min-h-[100px] resize-none"
          />

          {/* Image upload area */}
          <div
            className={`border-2 border-dashed rounded-lg p-3 text-center transition-colors cursor-pointer ${
              isDragging
                ? "border-primary bg-primary/5"
                : "border-muted-foreground/25 hover:border-muted-foreground/50"
            }`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => handleFileChange(e.target.files)}
            />
            <Upload className="w-5 h-5 mx-auto mb-1 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">
              Drag & drop images or click to upload
            </p>
            <p className="text-xs text-muted-foreground/70 mt-0.5">
              Max 3 images
            </p>
          </div>

          {/* Image previews */}
          {imagePreviews.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {imagePreviews.map((preview, index) => (
                <div key={index} className="relative group">
                  <img
                    src={preview}
                    alt={`Preview ${index + 1}`}
                    className="w-16 h-16 object-cover rounded-md border"
                  />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeImage(index);
                    }}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2">
            <div className="flex gap-1">
              {["😊", "😐", "😞", "🤩"].map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => setFeedback((prev) => prev + emoji)}
                  className="w-7 h-7 hover:bg-muted rounded-md transition-colors text-sm"
                >
                  {emoji}
                </button>
              ))}
            </div>
            <div className="flex-1" />
            <span className="text-xs text-muted-foreground">[M↓] supported.</span>
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={isSubmitting || !topic || !feedback.trim()}
            >
              {isSubmitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                "Send"
              )}
            </Button>
          </div>
        </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
