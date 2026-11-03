import { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Upload, FileSpreadsheet, AlertCircle, CheckCircle2, Download } from "lucide-react";
import { useIdeas } from "@/hooks/useIdeas";
import { useBrandVoices } from "@/hooks/useBrandVoices";
import { useProducts } from "@/hooks/useProducts";
import { useBlocks } from "@/hooks/useBlocks";

interface ImportIdeasCSVDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ParsedIdea {
  title: string;
  isValid: boolean;
  error?: string;
}

export function ImportIdeasCSVDialog({ open, onOpenChange }: ImportIdeasCSVDialogProps) {
  const [parsedIdeas, setParsedIdeas] = useState<ParsedIdea[]>([]);
  const [brandVoiceId, setBrandVoiceId] = useState<string>("");
  const [productId, setProductId] = useState<string>("");
  const [contentAngleId, setContentAngleId] = useState<string>("");
  const [fileName, setFileName] = useState<string>("");
  const [parseError, setParseError] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { createBulkIdeas, isCreatingBulk } = useIdeas();
  const { brandVoices } = useBrandVoices();
  const { products } = useProducts();
  const { blocks } = useBlocks('angle');

  const parseCSV = (content: string): ParsedIdea[] => {
    const lines = content.split(/\r?\n/).filter(line => line.trim());
    if (lines.length === 0) return [];

    // Check if first line is a header
    const firstLine = lines[0].toLowerCase().trim();
    const hasHeader = firstLine.includes('title') || firstLine.includes('idea') || firstLine.includes('topic');
    const dataLines = hasHeader ? lines.slice(1) : lines;

    return dataLines.map(line => {
      // Handle CSV with quotes
      let title = line.trim();

      // If the line contains commas, try to extract the first column
      if (title.includes(',')) {
        // Handle quoted values
        if (title.startsWith('"')) {
          const endQuote = title.indexOf('"', 1);
          if (endQuote > 0) {
            title = title.substring(1, endQuote);
          }
        } else {
          // Just take the first column
          title = title.split(',')[0].trim();
        }
      }

      // Remove surrounding quotes if present
      title = title.replace(/^["']|["']$/g, '').trim();

      if (!title) {
        return { title: '', isValid: false, error: 'Empty title' };
      }

      if (title.length > 500) {
        return { title: title.substring(0, 100) + '...', isValid: false, error: 'Title too long (max 500 chars)' };
      }

      return { title, isValid: true };
    }).filter(idea => idea.title || idea.error);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setParseError("");

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        const ideas = parseCSV(content);

        if (ideas.length === 0) {
          setParseError("No valid ideas found in the file");
          setParsedIdeas([]);
        } else {
          setParsedIdeas(ideas);
        }
      } catch (error) {
        setParseError("Failed to parse CSV file");
        setParsedIdeas([]);
      }
    };
    reader.onerror = () => {
      setParseError("Failed to read file");
      setParsedIdeas([]);
    };
    reader.readAsText(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const validIdeas = parsedIdeas.filter(idea => idea.isValid);
    if (validIdeas.length === 0) return;

    try {
      await createBulkIdeas(
        validIdeas.map(idea => ({
          title: idea.title,
          brand_voice_id: brandVoiceId || null,
          product_id: productId || null,
          content_angle_id: contentAngleId || null,
        }))
      );
      handleClose();
    } catch (error) {
      console.error('Error importing ideas:', error);
    }
  };

  const handleClose = () => {
    setParsedIdeas([]);
    setBrandVoiceId("");
    setProductId("");
    setContentAngleId("");
    setFileName("");
    setParseError("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    onOpenChange(false);
  };

  const downloadTemplate = () => {
    const template = "title\nHow to increase engagement on social media\n10 tips for better content marketing\nWhy video content outperforms text";
    const blob = new Blob([template], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ideas_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const validCount = parsedIdeas.filter(i => i.isValid).length;
  const invalidCount = parsedIdeas.filter(i => !i.isValid).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl h-[85vh] flex flex-col p-0">
        <div className="shrink-0 p-6 pb-4 border-b">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="w-5 h-5 text-primary" />
              Import Ideas from CSV
            </DialogTitle>
            <DialogDescription>
              Upload a CSV file with idea titles. Each row should contain one idea.
            </DialogDescription>
          </DialogHeader>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <ScrollArea className="flex-1 px-6">
            <div className="space-y-6 py-4">
              {/* File upload area */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>CSV File</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={downloadTemplate}
                    className="text-xs gap-1"
                  >
                    <Download className="w-3 h-3" />
                    Download template
                  </Button>
                </div>

                <div
                  className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.txt"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                  <Upload className="w-8 h-8 mx-auto mb-3 text-muted-foreground" />
                  {fileName ? (
                    <p className="text-sm font-medium">{fileName}</p>
                  ) : (
                    <>
                      <p className="text-sm font-medium">Click to upload or drag and drop</p>
                      <p className="text-xs text-muted-foreground mt-1">CSV or TXT file</p>
                    </>
                  )}
                </div>
              </div>

              {/* Parse error */}
              {parseError && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{parseError}</AlertDescription>
                </Alert>
              )}

              {/* Preview */}
              {parsedIdeas.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label>Preview ({parsedIdeas.length} rows)</Label>
                    <div className="flex items-center gap-3 text-xs">
                      {validCount > 0 && (
                        <span className="flex items-center gap-1 text-green-600">
                          <CheckCircle2 className="w-3 h-3" />
                          {validCount} valid
                        </span>
                      )}
                      {invalidCount > 0 && (
                        <span className="flex items-center gap-1 text-destructive">
                          <AlertCircle className="w-3 h-3" />
                          {invalidCount} invalid
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="border rounded-lg overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-12">#</TableHead>
                          <TableHead>Title</TableHead>
                          <TableHead className="w-24">Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {parsedIdeas.slice(0, 10).map((idea, index) => (
                          <TableRow key={index} className={!idea.isValid ? "bg-destructive/5" : ""}>
                            <TableCell className="text-muted-foreground">{index + 1}</TableCell>
                            <TableCell className="font-medium">
                              {idea.title || <span className="text-muted-foreground italic">Empty</span>}
                            </TableCell>
                            <TableCell>
                              {idea.isValid ? (
                                <CheckCircle2 className="w-4 h-4 text-green-600" />
                              ) : (
                                <span className="text-xs text-destructive">{idea.error}</span>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                        {parsedIdeas.length > 10 && (
                          <TableRow>
                            <TableCell colSpan={3} className="text-center text-muted-foreground text-sm">
                              ... and {parsedIdeas.length - 10} more rows
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}

              {/* Optional Library Elements */}
              {parsedIdeas.length > 0 && validCount > 0 && (
                <div className="space-y-4 pt-4 border-t">
                  <div>
                    <h3 className="text-sm font-medium mb-1">
                      Associate with Library Elements (Optional)
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Apply to all imported ideas
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="brand-voice" className="text-xs">Brand Voice</Label>
                      <Select
                        value={brandVoiceId || undefined}
                        onValueChange={setBrandVoiceId}
                        disabled={isCreatingBulk}
                      >
                        <SelectTrigger id="brand-voice">
                          <SelectValue placeholder="None" />
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

                    <div className="space-y-2">
                      <Label htmlFor="product" className="text-xs">Product</Label>
                      <Select
                        value={productId || undefined}
                        onValueChange={setProductId}
                        disabled={isCreatingBulk}
                      >
                        <SelectTrigger id="product">
                          <SelectValue placeholder="None" />
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

                    <div className="space-y-2">
                      <Label htmlFor="content-angle" className="text-xs">Content Angle</Label>
                      <Select
                        value={contentAngleId || undefined}
                        onValueChange={setContentAngleId}
                        disabled={isCreatingBulk}
                      >
                        <SelectTrigger id="content-angle">
                          <SelectValue placeholder="None" />
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
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>

          {/* Actions */}
          <div className="shrink-0 flex gap-3 justify-between items-center p-6 pt-4 border-t bg-background">
            <p className="text-sm text-muted-foreground">
              {validCount > 0 ? `${validCount} idea${validCount !== 1 ? 's' : ''} ready to import` : 'Upload a CSV file to get started'}
            </p>
            <div className="flex gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={handleClose}
                disabled={isCreatingBulk}
              >
                Cancel
              </Button>
              <Button variant="cta" type="submit" disabled={isCreatingBulk || validCount === 0}>
                {isCreatingBulk ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Importing...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4 mr-2" />
                    Import {validCount} Idea{validCount !== 1 ? 's' : ''}
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
