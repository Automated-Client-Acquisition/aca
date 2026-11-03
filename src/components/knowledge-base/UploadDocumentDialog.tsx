import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { FileText, Upload, X, File, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useUploadKnowledgeDocument } from "@/hooks/useKnowledgeBase";

interface UploadDocumentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const ACCEPTED_TYPES = {
  "application/pdf": [".pdf"],
  "text/plain": [".txt"],
  "text/markdown": [".md"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
};

const MAX_SIZE = 25 * 1024 * 1024; // 25MB

export function UploadDocumentDialog({ open, onOpenChange }: UploadDocumentDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const uploadMutation = useUploadKnowledgeDocument();

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const droppedFile = acceptedFiles[0];
    if (droppedFile) {
      setFile(droppedFile);
      // Auto-fill name from filename (without extension and hash suffixes)
      if (!name) {
        let fileName = droppedFile.name.replace(/\.[^/.]+$/, "");
        // Strip common hash suffixes (e.g. "My Doc 2ff1682ec99e81289e5bc39640684a7f")
        fileName = fileName.replace(/\s+[a-f0-9]{16,}$/i, "").trim();
        setName(fileName);
      }
    }
  }, [name]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED_TYPES,
    maxSize: MAX_SIZE,
    multiple: false,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!file || !name.trim()) return;

    await uploadMutation.mutateAsync({
      name: name.trim(),
      description: description.trim() || undefined,
      file,
    });

    // Reset and close
    setFile(null);
    setName("");
    setDescription("");
    onOpenChange(false);
  };

  const handleClose = () => {
    if (!uploadMutation.isPending) {
      setFile(null);
      setName("");
      setDescription("");
      onOpenChange(false);
    }
  };

  const removeFile = () => {
    setFile(null);
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getFileIcon = (type: string) => {
    if (type === "application/pdf") {
      return <FileText className="h-8 w-8 text-red-500" />;
    }
    return <File className="h-8 w-8 text-blue-500" />;
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload Knowledge Document</DialogTitle>
          <DialogDescription>
            Upload a document to add to your AI chatbot's knowledge base. Supported formats: PDF, TXT, DOCX, MD.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* File Drop Zone */}
          {!file ? (
            <div
              {...getRootProps()}
              className={`
                border-2 border-dashed rounded-lg p-8 text-center cursor-pointer
                transition-colors duration-200
                ${isDragActive
                  ? "border-primary bg-primary/5"
                  : "border-muted-foreground/25 hover:border-primary/50"
                }
              `}
            >
              <input {...getInputProps()} />
              <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
              {isDragActive ? (
                <p className="text-primary">Drop the file here...</p>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    Drag and drop a file here, or click to select
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    PDF, TXT, DOCX, MD (max 25MB)
                  </p>
                </>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-3 p-3 border rounded-lg bg-muted/30">
              {getFileIcon(file.type)}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{file.name}</p>
                <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={removeFile}
                disabled={uploadMutation.isPending}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}

          {/* Document Name */}
          <div className="space-y-2">
            <Label htmlFor="doc-name">Document Name</Label>
            <Input
              id="doc-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Product Catalog, FAQ, Pricing Guide"
              required
              disabled={uploadMutation.isPending}
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="doc-description">Description (optional)</Label>
            <Textarea
              id="doc-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of the document content..."
              rows={2}
              disabled={uploadMutation.isPending}
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={uploadMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="cta"
              disabled={!file || !name.trim() || uploadMutation.isPending}
            >
              {uploadMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 mr-2" />
                  Upload
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
