import { useState, useRef } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  FileText,
  File,
  MoreVertical,
  Trash2,
  RefreshCw,
  AlertCircle,
  BookOpen,
  Pencil,
  Upload,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Link } from "react-router-dom";
import { DocumentStatusBadge } from "./DocumentStatusBadge";
import {
  useKnowledgeDocuments,
  useDeleteKnowledgeDocument,
  useReprocessKnowledgeDocument,
  useBulkReindexDocuments,
  useRenameKnowledgeDocument,
  useReplaceKnowledgeDocumentFile,
  type KnowledgeDocument,
} from "@/hooks/useKnowledgeBase";
import { Skeleton } from "@/components/ui/skeleton";
import { ContentToolbar } from "@/components/ContentToolbar";

interface KnowledgeDocumentsTableProps {
  onUploadClick: () => void;
}

export function KnowledgeDocumentsTable({ onUploadClick }: KnowledgeDocumentsTableProps) {
  const { data: documents, isLoading, error } = useKnowledgeDocuments();
  const deleteMutation = useDeleteKnowledgeDocument();
  const reprocessMutation = useReprocessKnowledgeDocument();
  const bulkReindexMutation = useBulkReindexDocuments();
  const renameMutation = useRenameKnowledgeDocument();
  const replaceFileMutation = useReplaceKnowledgeDocumentFile();

  const [searchQuery, setSearchQuery] = useState("");
  const query = searchQuery.trim().toLowerCase();
  const visibleDocs = (documents ?? []).filter(
    (d) => !query || d.name?.toLowerCase().includes(query) || d.description?.toLowerCase().includes(query),
  );

  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Delete dialog
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [documentToDelete, setDocumentToDelete] = useState<KnowledgeDocument | null>(null);

  // Rename dialog
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [documentToRename, setDocumentToRename] = useState<KnowledgeDocument | null>(null);
  const [renameName, setRenameName] = useState("");
  const [renameDescription, setRenameDescription] = useState("");

  // Replace file — hidden file input
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [documentToReplace, setDocumentToReplace] = useState<KnowledgeDocument | null>(null);

  // Selection helpers
  const allSelected = visibleDocs.length > 0 && visibleDocs.every((d) => selectedIds.has(d.id));
  const someSelected = selectedIds.size > 0 && !allSelected;

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(visibleDocs.map((d) => d.id)));
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Actions
  const handleDeleteClick = (doc: KnowledgeDocument) => {
    setDocumentToDelete(doc);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (documentToDelete) {
      await deleteMutation.mutateAsync(documentToDelete.id);
      selectedIds.delete(documentToDelete.id);
      setSelectedIds(new Set(selectedIds));
      setDeleteDialogOpen(false);
      setDocumentToDelete(null);
    }
  };

  const handleReprocess = async (doc: KnowledgeDocument) => {
    await reprocessMutation.mutateAsync(doc.id);
  };

  const handleBulkReindex = async () => {
    if (selectedIds.size === 0) return;
    await bulkReindexMutation.mutateAsync(Array.from(selectedIds));
    setSelectedIds(new Set());
  };

  const handleRenameClick = (doc: KnowledgeDocument) => {
    setDocumentToRename(doc);
    setRenameName(doc.name);
    setRenameDescription(doc.description || "");
    setRenameDialogOpen(true);
  };

  const handleRenameConfirm = async () => {
    if (!documentToRename || !renameName.trim()) return;
    await renameMutation.mutateAsync({
      documentId: documentToRename.id,
      name: renameName.trim(),
      description: renameDescription.trim() || null,
    });
    setRenameDialogOpen(false);
    setDocumentToRename(null);
  };

  const handleReplaceClick = (doc: KnowledgeDocument) => {
    setDocumentToReplace(doc);
    // Trigger file picker
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset input so the same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = "";

    if (!file || !documentToReplace) return;
    await replaceFileMutation.mutateAsync({
      documentId: documentToReplace.id,
      file,
    });
    setDocumentToReplace(null);
  };

  const formatFileSize = (bytes: number | null): string => {
    if (!bytes) return "-";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getFileIcon = (fileType: string) => {
    if (fileType === "pdf") {
      return <FileText className="h-5 w-5 text-red-500" />;
    }
    if (fileType === "docx") {
      return <FileText className="h-5 w-5 text-blue-500" />;
    }
    if (fileType === "md") {
      return <FileText className="h-5 w-5 text-purple-500" />;
    }
    return <File className="h-5 w-5 text-gray-500" />;
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <AlertCircle className="h-10 w-10 text-destructive mb-4" />
        <p className="text-muted-foreground">Failed to load documents</p>
        <p className="text-sm text-muted-foreground mt-1">
          {error instanceof Error ? error.message : "Unknown error"}
        </p>
      </div>
    );
  }

  if (!documents || documents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center border rounded-xl bg-card">
        <BookOpen className="h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-medium mb-2">No documents yet</h3>
        <p className="text-muted-foreground mb-6 max-w-sm">
          Upload PDFs, Word or Markdown files about your business. The AI reads them when it generates ideas, writes email sequences and drafts replies.
        </p>
        <Button variant="cta" onClick={onUploadClick}>
          <Upload className="h-4 w-4 mr-2" />
          Upload document
        </Button>
      </div>
    );
  }

  return (
    <>
      {/* Hidden file input for replace */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.txt,.md,.docx"
        className="hidden"
        onChange={handleFileSelected}
      />

      <ContentToolbar searchValue={searchQuery} onSearchChange={setSearchQuery} />

      {/* Bulk actions bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 mb-3 p-3 bg-muted/50 border rounded-lg">
          <span className="text-sm font-medium">
            {selectedIds.size} selected
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={handleBulkReindex}
            disabled={bulkReindexMutation.isPending}
          >
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            {bulkReindexMutation.isPending ? "Re-indexing..." : "Re-index"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setSelectedIds(new Set())}
          >
            Clear selection
          </Button>
        </div>
      )}

      <div className="rounded-xl border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[40px]">
                <Checkbox
                  checked={allSelected ? true : someSelected ? "indeterminate" : false}
                  onCheckedChange={toggleSelectAll}
                  aria-label="Select all"
                />
              </TableHead>
              <TableHead className="w-[45%]">Document</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Size</TableHead>
              <TableHead>Chunks</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Added</TableHead>
              <TableHead className="w-[50px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleDocs.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">
                  No documents match "{searchQuery}".
                </TableCell>
              </TableRow>
            )}
            {visibleDocs.map((doc) => (
              <TableRow key={doc.id} data-state={selectedIds.has(doc.id) ? "selected" : undefined}>
                <TableCell>
                  <Checkbox
                    checked={selectedIds.has(doc.id)}
                    onCheckedChange={() => toggleSelect(doc.id)}
                    aria-label={`Select ${doc.name}`}
                  />
                </TableCell>
                {/* max-w-0 lets the 45% header set the width, so long descriptions truncate instead of widening the table */}
                <TableCell className="max-w-0">
                  <div className="flex items-center gap-3">
                    <span className="shrink-0">{getFileIcon(doc.file_type)}</span>
                    <div className="min-w-0">
                      <p className="font-medium truncate">{doc.name}</p>
                      {doc.description && (
                        <p className="text-sm text-muted-foreground truncate">
                          {doc.description}
                        </p>
                      )}
                    </div>
                  </div>
                </TableCell>
                <TableCell className="uppercase text-sm text-muted-foreground">
                  {doc.file_type}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {formatFileSize(doc.file_size_bytes)}
                </TableCell>
                <TableCell className="text-sm">
                  {doc.status === "completed" ? doc.chunk_count : "-"}
                </TableCell>
                <TableCell>
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <DocumentStatusBadge status={doc.status} />
                      {doc.status === "failed" && doc.processing_error && !doc.processing_error.includes("OpenRouter API key") && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <AlertCircle className="h-4 w-4 text-destructive cursor-help" />
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs">
                            <p className="text-sm">{doc.processing_error}</p>
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                    {doc.status === "failed" && doc.processing_error?.includes("OpenRouter API key") && (
                      <p className="text-xs text-destructive flex items-center gap-1">
                        <AlertCircle className="h-3 w-3 shrink-0" />
                        OpenRouter key needs embedding access.{" "}
                        <Link to="/settings?tab=integrations" className="underline underline-offset-2 hover:text-destructive/80">
                          Update in Settings
                        </Link>
                      </p>
                    )}
                  </div>
                </TableCell>
                <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                  {formatDistanceToNow(new Date(doc.created_at), { addSuffix: true })}
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => handleRenameClick(doc)}>
                        <Pencil className="h-4 w-4 mr-2" />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => handleReplaceClick(doc)}
                        disabled={replaceFileMutation.isPending}
                      >
                        <Upload className="h-4 w-4 mr-2" />
                        Replace file
                      </DropdownMenuItem>
                      {(doc.status === "failed" || doc.status === "pending" || doc.status === "completed") && (
                        <DropdownMenuItem
                          onClick={() => handleReprocess(doc)}
                          disabled={reprocessMutation.isPending}
                        >
                          <RefreshCw className="h-4 w-4 mr-2" />
                          Re-index
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => handleDeleteClick(doc)}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Document</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{documentToDelete?.name}"? This will remove the document and all its processed chunks. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Rename Dialog */}
      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename Document</DialogTitle>
            <DialogDescription>
              Update the name and description for this document.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="rename-name">Name</Label>
              <Input
                id="rename-name"
                value={renameName}
                onChange={(e) => setRenameName(e.target.value)}
                placeholder="Document name"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rename-description">Description (optional)</Label>
              <Textarea
                id="rename-description"
                value={renameDescription}
                onChange={(e) => setRenameDescription(e.target.value)}
                placeholder="Brief description..."
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRenameDialogOpen(false)}
              disabled={renameMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleRenameConfirm}
              disabled={!renameName.trim() || renameMutation.isPending}
            >
              {renameMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
