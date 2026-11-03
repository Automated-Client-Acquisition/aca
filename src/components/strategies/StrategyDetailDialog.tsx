import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AutosaveIndicator } from "@/components/ui/autosave-indicator";
import { useAutosave } from "@/hooks/useAutosave";
import { useState, useEffect, useRef } from "react";
import { Calendar, Trash2, FileText, Hash, BookOpen, FileEdit, Upload, ExternalLink, X, Loader2 } from "lucide-react";
import { MarkdownEditor } from "./MarkdownEditor";
import { formatDate } from "@/lib/tableUtils";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { EditableList } from "../EditableList";
import { StrategyDocument, STRATEGY_DOCUMENT_TYPES, getDocumentTypeLabel, getDocumentTypeIcon } from "@/types/strategyDocument";
import { supabase } from "@/integrations/supabase/client";
import { nanoid } from "nanoid";
import { toast } from "sonner";

interface StrategyDetailDialogProps {
  document: StrategyDocument | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (id: string, updates: Partial<StrategyDocument>) => void;
  onDelete: (id: string) => void;
  isUpdating: boolean;
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

const getFileIcon = (mimeType: string | null) => {
  if (!mimeType) return '📄';
  if (mimeType.startsWith('image/')) return '🖼️';
  if (mimeType === 'application/pdf') return '📕';
  if (mimeType.includes('word')) return '📝';
  if (mimeType.includes('excel') || mimeType.includes('spreadsheet')) return '📊';
  if (mimeType.includes('powerpoint') || mimeType.includes('presentation')) return '📽️';
  return '📄';
};

export function StrategyDetailDialog({ document, open, onOpenChange, onSave, onDelete, isUpdating }: StrategyDetailDialogProps) {
  const [edited, setEdited] = useState<Partial<StrategyDocument>>({});
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || !document) {
      setEdited({});
    }
  }, [open, document?.id]);

  const { isSaving } = useAutosave(
    (updates) => {
      if (document) {
        onSave(document.id, updates);
      }
    },
    edited,
    1000,
    Object.keys(edited).length > 0 && !isUpdating
  );

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

    const result = await uploadFile(selectedFile);
    if (result) {
      setEdited({
        ...edited,
        file_url: result.url,
        file_name: result.name,
        file_type: result.type
      });
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleRemoveFile = () => {
    setEdited({
      ...edited,
      file_url: null,
      file_name: null,
      file_type: null
    });
  };

  const handleSave = () => {
    if (document && Object.keys(edited).length > 0) {
      onSave(document.id, edited);
      setEdited({});
      onOpenChange(false);
    } else {
      onOpenChange(false);
    }
  };

  const handleDelete = () => {
    if (document) {
      onDelete(document.id);
      setDeleteDialogOpen(false);
      onOpenChange(false);
    }
  };

  if (!document) return null;

  const currentName = edited.name ?? document.name;
  const currentDescription = edited.description ?? document.description ?? "";
  const currentDocumentType = edited.document_type ?? document.document_type;
  const currentContent = edited.content ?? document.content ?? "";
  const currentTags = edited.tags ?? document.tags ?? [];
  const currentFileUrl = edited.file_url !== undefined ? edited.file_url : document.file_url;
  const currentFileName = edited.file_name !== undefined ? edited.file_name : document.file_name;
  const currentFileType = edited.file_type !== undefined ? edited.file_type : document.file_type;

  const hasFile = !!currentFileUrl;
  const hasContent = !!currentContent;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex flex-col h-[90vh] overflow-hidden max-w-4xl">
          <form className="flex flex-col flex-1 min-h-0" onSubmit={(e) => { e.preventDefault(); handleSave(); }}>
            <DialogHeader className="shrink-0 px-8 py-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-5">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500/20 to-primary/20 flex items-center justify-center text-2xl">
                    {getDocumentTypeIcon(currentDocumentType)}
                  </div>
                  <div>
                    <DialogTitle className="text-2xl">Edit Strategy Document</DialogTitle>
                    <div className="flex items-center gap-3 mt-1">
                      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <Calendar className="w-3.5 h-3.5" />
                        {formatDate(document.updated_at)}
                      </div>
                      <Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-500/30">
                        {getDocumentTypeLabel(currentDocumentType)}
                      </Badge>
                      {hasFile && (
                        <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/30">
                          Has File
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
                <AutosaveIndicator isSaving={isSaving} />
              </div>
            </DialogHeader>

            <ScrollArea className="flex-1 min-h-0">
              <div className="space-y-6 px-8 py-6">
                <Card className="border-2 border-primary/20 bg-gradient-to-br from-primary/5 to-transparent overflow-hidden">
                  <div className="h-1.5 bg-gradient-to-r from-primary to-primary/60" />
                  <CardContent className="pt-6 space-y-5">
                    <div className="space-y-2">
                      <Label htmlFor="documentType" className="text-base font-semibold flex items-center gap-2">
                        <FileText className="w-4 h-4" />
                        Document Type
                      </Label>
                      <Select
                        value={currentDocumentType}
                        onValueChange={(value) => setEdited({ ...edited, document_type: value as any })}
                      >
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
                      <Label htmlFor="name" className="text-base font-semibold">Name</Label>
                      <Input
                        id="name"
                        value={currentName}
                        onChange={(e) => setEdited({ ...edited, name: e.target.value })}
                        className="h-11 text-base font-medium focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="description" className="text-base font-semibold flex items-center gap-2">
                        <BookOpen className="w-4 h-4" />
                        Description
                      </Label>
                      <Textarea
                        id="description"
                        value={currentDescription}
                        onChange={(e) => setEdited({ ...edited, description: e.target.value })}
                        placeholder="Brief description of this strategy document..."
                        className="resize-y min-h-[80px] max-h-[150px] focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    </div>
                  </CardContent>
                </Card>

                {/* File Section */}
                <div className="space-y-3">
                  <Label className="text-base font-semibold flex items-center gap-2">
                    <Upload className="w-4 h-4" />
                    Attached File
                  </Label>

                  {hasFile ? (
                    <div className="border rounded-lg p-4">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center text-2xl">
                          {getFileIcon(currentFileType)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{currentFileName || 'Attached file'}</p>
                          <p className="text-sm text-muted-foreground">
                            {currentFileType || 'Unknown type'}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => window.open(currentFileUrl!, '_blank')}
                            className="gap-1.5"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            Open
                          </Button>
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
                    </div>
                  ) : (
                    <div
                      className="border-2 border-dashed rounded-lg p-6 text-center hover:border-primary/50 transition-colors cursor-pointer"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.webp,.gif,.txt,.md"
                        onChange={handleFileSelect}
                        className="hidden"
                      />
                      {isUploading ? (
                        <>
                          <Loader2 className="w-8 h-8 mx-auto text-muted-foreground mb-2 animate-spin" />
                          <p className="text-sm text-muted-foreground">Uploading...</p>
                        </>
                      ) : (
                        <>
                          <Upload className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
                          <p className="text-sm font-medium mb-1">Click to upload a file</p>
                          <p className="text-xs text-muted-foreground">
                            PDF, Word, Excel, PowerPoint, images, or text files (max 25MB)
                          </p>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* Content Section */}
                <div className="space-y-5">
                  <div className="space-y-2">
                    <Label htmlFor="content" className="text-base font-semibold flex items-center gap-2">
                      <FileEdit className="w-4 h-4" />
                      Content (Markdown)
                      {!hasFile && <span className="text-muted-foreground font-normal text-sm">— Required if no file attached</span>}
                    </Label>
                    <MarkdownEditor
                      value={currentContent}
                      onChange={(value) => setEdited({ ...edited, content: value })}
                      placeholder="Enter your strategy document content in Markdown format..."
                      minHeight="450px"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-base font-semibold flex items-center gap-2">
                      <Hash className="w-4 h-4" />
                      Tags
                    </Label>
                    <EditableList
                      items={currentTags}
                      onChange={(items) => setEdited({ ...edited, tags: items })}
                      placeholder="Add organizational tags..."
                    />
                  </div>
                </div>
              </div>
            </ScrollArea>

            <div className="shrink-0 flex items-center justify-between px-8 py-6 border-t">
              <Button
                type="button"
                variant="destructive"
                onClick={() => setDeleteDialogOpen(true)}
                disabled={isUpdating}
                className="gap-2"
              >
                <Trash2 className="w-4 h-4" />
                Delete Document
              </Button>
              <Button
                type="button"
                onClick={() => onOpenChange(false)}
                className="min-w-24"
              >
                Close
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Strategy Document</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{document.name}"? This action cannot be undone.
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
    </>
  );
}
