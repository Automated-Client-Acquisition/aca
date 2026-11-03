import { useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { OutputStatusBadge } from "./OutputStatusBadge";
import { useUpdateContentOutput } from "@/hooks/useUpdateContentOutput";
import { useDeleteContentOutput } from "@/hooks/useDeleteContentOutput";
import { useGenerateImage } from "@/hooks/useGenerateImage";
import { useQueryClient } from "@tanstack/react-query";
import { 
  Copy, 
  Edit2, 
  Save, 
  Trash2, 
  RefreshCw,
  CheckCircle,
  XCircle,
  Sparkles,
  Loader2,
  Download
} from "lucide-react";
import { PlatformReadinessIndicator } from './PlatformReadinessIndicator';
import { PublishedPlatformsBadge } from './PublishedPlatformsBadge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { getPipelineLabel } from "@/lib/pipeline-labels";

interface ContentOutputCardProps {
  output: any;
  isSelected: boolean;
  onSelect: (selected: boolean) => void;
}

export function ContentOutputCard({ output, isSelected, onSelect }: ContentOutputCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedText, setEditedText] = useState(output.data?.text || '');
  const [isEditingPrompt, setIsEditingPrompt] = useState(false);
  const [editedPrompt, setEditedPrompt] = useState(output.data?.image_prompt || '');
  const updateOutput = useUpdateContentOutput();
  const deleteOutput = useDeleteContentOutput();
  const generateImage = useGenerateImage();
  const queryClient = useQueryClient();

  const title = output.data?.title || getPipelineLabel(output.pipeline) || `Output ${output.id.slice(0, 8)}`;
  const text = output.data?.text || '';
  const imagePrompt = output.data?.image_prompt;
  const imageUrl = output.data?.image_url;
  const metadata = output.data?.metadata || {};
  const variantContext = metadata.variant_context || {};

  const jobId = output.job_id;

  const handleSave = () => {
    updateOutput.mutate({
      id: output.id,
      data: { ...output.data, text: editedText },
      jobId
    });
    setIsEditing(false);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  const handleStatusChange = (status: 'approved' | 'rejected' | 'review') => {
    updateOutput.mutate({ id: output.id, status, jobId });
  };

  const handleDelete = () => {
    if (confirm('Are you sure you want to delete this output?')) {
      deleteOutput.mutate({ id: output.id, jobId });
    }
  };

  const handleSavePrompt = () => {
    updateOutput.mutate({
      id: output.id,
      data: { ...output.data, image_prompt: editedPrompt },
      jobId
    });
    setIsEditingPrompt(false);
  };

  const handleGenerateImage = async () => {
    const promptToUse = editedPrompt || imagePrompt;
    if (!promptToUse) {
      toast.error('Please provide an image prompt');
      return;
    }

    generateImage.mutate(
      { outputId: output.id, prompt: promptToUse, jobId },
      {
        onSuccess: () => {
          // Refetch the outputs to get the updated image
          queryClient.invalidateQueries({ queryKey: ['content-outputs', jobId] });
        }
      }
    );
  };

  const handleDownloadImage = async () => {
    if (!imageUrl) return;
    try {
      const filename = `output-${output.id.slice(0, 8)}.jpg`;
      // Use download proxy to add proper Content-Disposition header
      const proxyUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/download-proxy?url=${encodeURIComponent(imageUrl)}&filename=${encodeURIComponent(filename)}`;

      const a = document.createElement("a");
      a.href = proxyUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      toast.success("Image download started");
    } catch (error) {
      toast.error("Failed to download image");
    }
  };

  const statusColors = {
    approved: 'border-l-green-500',
    rejected: 'border-l-red-500', 
    review: 'border-l-amber-500',
    generating: 'border-l-blue-500'
  };

  return (
    <Card 
      className={`relative border-l-4 transition-all duration-200 cursor-pointer group ${statusColors[output.status || 'review']} ${isSelected ? 'ring-2 ring-primary shadow-lg' : 'hover:shadow-md'}`}
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest('button, textarea, input, a')) {
          onSelect(!isSelected);
        }
      }}
    >
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 space-y-2">
            <h3 className="font-semibold text-lg leading-tight">{title}</h3>
            
            <div className="flex flex-wrap gap-1.5">
              {variantContext.brand_voice && (
                <Badge variant="outline" className="text-xs">
                  {variantContext.brand_voice}
                </Badge>
              )}
              {variantContext.angle && (
                <Badge variant="outline" className="text-xs">
                  {variantContext.angle}
                </Badge>
              )}
              {variantContext.product && (
                <Badge variant="outline" className="text-xs">
                  {variantContext.product}
                </Badge>
              )}
              {metadata.character_count && (
                <Badge variant="secondary" className="text-xs">
                  {metadata.character_count} chars
                </Badge>
              )}
            </div>
          </div>
          <OutputStatusBadge status={output.status || 'review'} />
        </div>
      </CardHeader>

        <CardContent className="space-y-4">
          {/* Platform Readiness */}
          <div className="space-y-3">
            <PlatformReadinessIndicator 
              outputData={output.data} 
              mode="expanded"
            />
            <PublishedPlatformsBadge outputId={output.id} variant="detailed" />
          </div>
          
          {isEditing ? (
          <div className="space-y-3">
            <Textarea
              value={editedText}
              onChange={(e) => setEditedText(e.target.value)}
              className="min-h-[180px] text-sm leading-relaxed"
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={handleSave}>
                <Save className="w-4 h-4 mr-2" />
                Save
              </Button>
              <Button size="sm" variant="outline" onClick={() => setIsEditing(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="prose prose-sm max-w-none">
            <p className="whitespace-pre-wrap text-foreground leading-relaxed text-base">{text}</p>
          </div>
        )}

        {(imagePrompt || imageUrl) && (
          <div className="border rounded-lg p-4 bg-muted/30 space-y-3">
            {imageUrl && (
              <div className="relative rounded-md overflow-hidden group">
                <img 
                  src={imageUrl} 
                  alt="Generated content"
                  className="w-full h-auto"
                />
                <Button
                  size="sm"
                  variant="secondary"
                  className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity gap-1"
                  onClick={handleDownloadImage}
                >
                  <Download className="h-3 w-3" />
                  Download
                </Button>
              </div>
            )}

            {isEditingPrompt ? (
              <div className="space-y-2">
                <Textarea
                  value={editedPrompt}
                  onChange={(e) => setEditedPrompt(e.target.value)}
                  className="min-h-[80px] text-sm"
                  placeholder="Describe the image..."
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleSavePrompt}>
                    <Save className="w-3 h-3 mr-1" />
                    Save
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setIsEditingPrompt(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : imagePrompt && (
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm text-muted-foreground flex-1">{imagePrompt}</p>
                <Button 
                  size="sm" 
                  variant="ghost"
                  onClick={() => {
                    setEditedPrompt(imagePrompt);
                    setIsEditingPrompt(true);
                  }}
                  className="shrink-0"
                >
                  <Edit2 className="w-3 h-3" />
                </Button>
              </div>
            )}

            <Button 
              size="sm" 
              variant="default"
              onClick={handleGenerateImage}
              disabled={generateImage.isPending}
              className="w-full"
            >
              {generateImage.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-2" />
                  {imageUrl ? 'Regenerate' : 'Generate Image'}
                </>
              )}
            </Button>
          </div>
        )}

        <div className="flex items-center gap-2 pt-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setIsEditing(true)}
            disabled={isEditing}
          >
            <Edit2 className="w-4 h-4 mr-2" />
            Edit
          </Button>
          
          <Button
            size="sm"
            variant="ghost"
            onClick={handleCopy}
          >
            <Copy className="w-4 h-4 mr-2" />
            Copy
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost">
                •••
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleStatusChange('approved')}>
                <CheckCircle className="w-4 h-4 mr-2" />
                Approve
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleStatusChange('rejected')}>
                <XCircle className="w-4 h-4 mr-2" />
                Reject
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleStatusChange('review')}>
                <RefreshCw className="w-4 h-4 mr-2" />
                Review
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem 
                onClick={handleDelete}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardContent>
    </Card>
  );
}
