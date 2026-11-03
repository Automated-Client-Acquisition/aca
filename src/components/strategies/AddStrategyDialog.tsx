import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useState, useRef } from "react";
import { useStrategyDocuments } from "@/hooks/useStrategyDocuments";
import { supabase } from "@/integrations/supabase/client";
import { nanoid } from "nanoid";
import { toast } from "sonner";
import { FileText, Hash, BookOpen, Check, FileEdit, Upload, X, File, Loader2 } from "lucide-react";
import { EditableList } from "../EditableList";
import { StrategyDocumentType, STRATEGY_DOCUMENT_TYPES, getDocumentTypeIcon } from "@/types/strategyDocument";
import { MarkdownEditor } from "./MarkdownEditor";

interface AddStrategyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const VALID_FILE_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'text/plain',
  'text/markdown',
];

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB

export function AddStrategyDialog({ open, onOpenChange }: AddStrategyDialogProps) {
  const { createDocument, isCreating } = useStrategyDocuments();
  const [contentMode, setContentMode] = useState<"write" | "upload">("write");
  const [documentType, setDocumentType] = useState<StrategyDocumentType>("lead_magnet");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState("");
  const [tags, setTags] = useState<string[]>([]);

  // File upload state
  const [file, setFile] = useState<File | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadFile = async (fileToUpload: File): Promise<{ url: string; name: string; type: string } | null> => {
    try {
      setIsUploading(true);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error("You must be logged in to upload files");
        return null;
      }

      if (!VALID_FILE_TYPES.includes(fileToUpload.type)) {
        toast.error("Invalid file type. Supported: PDF, Word, Excel, PowerPoint, images, text files.");
        return null;
      }

      if (fileToUpload.size > MAX_FILE_SIZE) {
        toast.error("File too large. Maximum size is 25MB.");
        return null;
      }

      const fileExt = fileToUpload.name.split('.').pop();
      const fileName = `${nanoid()}.${fileExt}`;
      const filePath = `${user.id}/strategies/${fileName}`;

      const { error } = await supabase.storage
        .from('content-media')
        .upload(filePath, fileToUpload, {
          cacheControl: '3600',
          upsert: false
        });

      if (error) {
        console.error("Upload error:", error);
        toast.error(`Upload failed: ${error.message}`);
        return null;
      }

      const { data: { publicUrl } } = supabase.storage
        .from('content-media')
        .getPublicUrl(filePath);

      toast.success("File uploaded successfully!");
      return {
        url: publicUrl,
        name: fileToUpload.name,
        type: fileToUpload.type
      };
    } catch (error) {
      console.error("Upload error:", error);
      toast.error("Failed to upload file");
      return null;
    } finally {
      setIsUploading(false);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setFile(selectedFile);
    const result = await uploadFile(selectedFile);
    if (result) {
      setFileUrl(result.url);
    } else {
      setFile(null);
    }
  };

  const handleRemoveFile = () => {
    setFile(null);
    setFileUrl(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSubmit = async () => {
    const hasContent = contentMode === "write" && content.trim();
    const hasFile = contentMode === "upload" && fileUrl && file;

    if (!hasContent && !hasFile) {
      toast.error("Please add content or upload a file");
      return;
    }

    await createDocument({
      document_type: documentType,
      name,
      description: description || null,
      content: contentMode === "write" ? content : null,
      file_url: contentMode === "upload" ? fileUrl : null,
      file_name: contentMode === "upload" && file ? file.name : null,
      file_type: contentMode === "upload" && file ? file.type : null,
      tags: tags.length > 0 ? tags : null,
    } as any);
    resetForm();
    onOpenChange(false);
  };

  const resetForm = () => {
    setContentMode("write");
    setDocumentType("lead_magnet");
    setName("");
    setDescription("");
    setContent("");
    setTags([]);
    setFile(null);
    setFileUrl(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      resetForm();
    }
    onOpenChange(newOpen);
  };

  const isValid = name.trim() && (
    (contentMode === "write" && content.trim()) ||
    (contentMode === "upload" && fileUrl)
  );

  const getFileIcon = (mimeType: string) => {
    if (mimeType.startsWith('image/')) return '🖼️';
    if (mimeType === 'application/pdf') return '📕';
    if (mimeType.includes('word')) return '📝';
    if (mimeType.includes('excel') || mimeType.includes('spreadsheet')) return '📊';
    if (mimeType.includes('powerpoint') || mimeType.includes('presentation')) return '📽️';
    return '📄';
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex flex-col h-[90vh] overflow-hidden max-w-4xl p-0">
        <form className="flex flex-col flex-1 min-h-0" onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
          {/* Header with gradient background */}
          <div className="shrink-0 px-6 pt-6 pb-4 bg-gradient-to-br from-blue-500/10 via-primary/5 to-transparent relative">
            <div className="absolute top-4 right-8">
              <Badge className="bg-gradient-to-r from-blue-500 to-primary text-white border-0">
                <FileText className="w-3 h-3 mr-1" />
                New Strategy
              </Badge>
            </div>
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-primary flex items-center justify-center shadow-lg text-2xl">
                {getDocumentTypeIcon(documentType)}
              </div>
              <div>
                <DialogTitle className="text-xl font-bold">Create Strategy Document</DialogTitle>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Add lead magnets, sales strategies, content calendars, and more
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
                    <Label htmlFor="documentType" className="text-base font-semibold flex items-center gap-2">
                      <FileText className="w-4 h-4" />
                      Document Type *
                    </Label>
                    <Select value={documentType} onValueChange={(value) => setDocumentType(value as StrategyDocumentType)}>
                      <SelectTrigger className="h-11">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STRATEGY_DOCUMENT_TYPES.map((type) => (
                          <SelectItem key={type.value} value={type.value}>
                            <div className="flex items-center gap-2">
                              <span>{type.icon}</span>
                              {type.label}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="name" className="text-base font-semibold">Name *</Label>
                    <Input
                      id="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g., 7-Day Email Welcome Sequence"
                      className="h-11 text-base focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="description" className="text-base font-semibold flex items-center gap-2">
                      <BookOpen className="w-4 h-4" />
                      Description
                    </Label>
                    <Textarea
                      id="description"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Brief description of this strategy document..."
                      className="resize-y min-h-[80px] max-h-[150px] focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>
                </CardContent>
              </Card>

              <div className="space-y-5">
                <Tabs value={contentMode} onValueChange={(v) => setContentMode(v as "write" | "upload")}>
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="write" className="gap-2">
                      <FileEdit className="w-4 h-4" />
                      Write Content
                    </TabsTrigger>
                    <TabsTrigger value="upload" className="gap-2">
                      <Upload className="w-4 h-4" />
                      Upload File
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="write" className="mt-4">
                    <div className="space-y-2">
                      <Label htmlFor="content" className="text-base font-semibold flex items-center gap-2">
                        <FileEdit className="w-4 h-4" />
                        Content (Markdown) *
                      </Label>
                      <MarkdownEditor
                        value={content}
                        onChange={setContent}
                        placeholder="Enter your strategy document content in Markdown format...

# Example Structure

## Overview
Brief introduction...

## Key Points
- Point 1
- Point 2

## Implementation Steps
1. First step
2. Second step"
                        minHeight="400px"
                      />
                    </div>
                  </TabsContent>

                  <TabsContent value="upload" className="mt-4">
                    <div className="space-y-4">
                      <Label className="text-base font-semibold flex items-center gap-2">
                        <Upload className="w-4 h-4" />
                        Upload Document *
                      </Label>

                      {!file ? (
                        <div
                          className="border-2 border-dashed rounded-lg p-8 text-center hover:border-primary/50 transition-colors cursor-pointer"
                          onClick={() => fileInputRef.current?.click()}
                        >
                          <input
                            ref={fileInputRef}
                            type="file"
                            accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.webp,.gif,.txt,.md"
                            onChange={handleFileSelect}
                            className="hidden"
                          />
                          <Upload className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
                          <p className="text-sm font-medium mb-1">Click to upload a file</p>
                          <p className="text-xs text-muted-foreground">
                            PDF, Word, Excel, PowerPoint, images, or text files (max 25MB)
                          </p>
                        </div>
                      ) : (
                        <div className="border rounded-lg p-4">
                          <div className="flex items-center gap-3">
                            <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center text-2xl">
                              {isUploading ? (
                                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                              ) : (
                                getFileIcon(file.type)
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-medium truncate">{file.name}</p>
                              <p className="text-sm text-muted-foreground">
                                {isUploading ? 'Uploading...' : fileUrl ? 'Uploaded successfully' : 'Upload failed'}
                              </p>
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={handleRemoveFile}
                              disabled={isUploading}
                            >
                              <X className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  </TabsContent>
                </Tabs>

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
              {isValid ? "Ready to create" : "Fill in required fields"}
            </span>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={isCreating || isUploading}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isCreating || isUploading || !isValid}
                className="min-w-[140px] bg-gradient-to-r from-blue-500 to-primary hover:opacity-90"
              >
                {isCreating ? (
                  <>Creating...</>
                ) : (
                  <>
                    <Check className="w-4 h-4 mr-2" />
                    Create Strategy
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
