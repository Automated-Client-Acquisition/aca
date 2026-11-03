import { useState, useMemo, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight, Copy, Trash2, ChevronDown, Download, Globe, CheckCircle2, XCircle, Clock, Loader2, FileText, Image, Search, Settings, Bookmark } from "lucide-react";
import { SaveContentMultiDialog, type SaveableContent } from "@/components/saved-content/SaveContentMultiDialog";
import { TextContentSection } from "../viewers/TextContentSection";
import { ImageContentSection } from "../viewers/ImageContentSection";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SEOMetadataEditor } from "../editors/SEOMetadataEditor";
import { ArticleMetadataEditor } from "../editors/ArticleMetadataEditor";
import { ExportArticleDialog } from "../dialogs/ExportArticleDialog";
import { WordPressPublishDialog } from "../dialogs/WordPressPublishDialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface ArticleLayoutProps {
  output: any;
  currentIndex: number;
  totalCount: number;
  onPrevious: () => void;
  onNext: () => void;
  onApprove: () => void;
  onReject: () => void;
  onDelete: () => void;
  onCopy?: () => void;
  onUpdateText?: (newContent: string) => void;
  onUpdateImage?: (newImageUrl: string | null) => void;
  onRegenerateText?: (instructions?: string) => void;
  onGenerateImage?: (prompt: string) => void;
  onRegenerateImage?: (prompt: string, instructions?: string) => void;
  isGeneratingImage?: boolean;
  isRegeneratingText?: boolean;
}

const getStatusConfig = (status: string) => {
  switch (status) {
    case 'approved':
      return {
        label: 'Approved',
        icon: CheckCircle2,
        className: 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/30'
      };
    case 'rejected':
      return {
        label: 'Rejected',
        icon: XCircle,
        className: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30'
      };
    case 'review':
      return {
        label: 'Needs Review',
        icon: Clock,
        className: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30'
      };
    case 'generating':
    case 'processing':
      return {
        label: 'Generating',
        icon: Loader2,
        className: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30',
        loading: true
      };
    default:
      return {
        label: status,
        icon: Clock,
        className: 'bg-muted text-muted-foreground border-border'
      };
  }
};

export function ArticleLayout({
  output,
  currentIndex,
  totalCount,
  onPrevious,
  onNext,
  onApprove,
  onReject,
  onDelete,
  onCopy,
  onUpdateText,
  onUpdateImage,
  onRegenerateText,
  onGenerateImage,
  onRegenerateImage,
  isGeneratingImage = false,
  isRegeneratingText = false,
}: ArticleLayoutProps) {
  const [activeTab, setActiveTab] = useState("content");
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [showWordPressDialog, setShowWordPressDialog] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);

  const data = output.data || {};
  const params = output.generation_params || {};
  const stageData = output.stage_data || {};
  const textContent = data.text || data.content || '';
  const imageUrl = data.image_url || data.imageUrl || stageData.image?.url || stageData.image?.image_url;
  // Get image prompt from multiple sources
  const imagePrompt = data.image_prompt || data.imagePrompt || stageData.image?.prompt || params.resolved_image_prompt || params.image_prompt || '';

  const title = data.title || params.idea?.title || 'Untitled Article';

  // Extract metadata for chips (character takes priority over brand voice)
  const characterName = params.character?.name || params.library_characters?.name;
  const brandVoiceName = params.brand_voice?.name || params.library_brand_voices?.name;
  const metadataLabel = characterName || brandVoiceName;
  const wordCount = textContent.trim().split(/\s+/).filter(Boolean).length;
  const readingTime = Math.max(1, Math.ceil(wordCount / 200));

  // SEO data with local state for immediate updates
  const [seoData, setSeoData] = useState(() => ({
    meta_title: data.seo?.meta_title || '',
    meta_description: data.seo?.meta_description || '',
    slug: data.seo?.slug || '',
    focus_keyword: data.seo?.focus_keyword || '',
  }));

  // Metadata with local state for immediate updates
  const [metadata, setMetadata] = useState(() => ({
    excerpt: data.metadata?.excerpt || '',
    categories: data.metadata?.categories || [],
    tags: data.metadata?.tags || [],
    featured_image_alt: data.metadata?.featured_image_alt || '',
    author: data.metadata?.author || '',
  }));

  // Sync state when output changes (e.g., navigating between outputs)
  useEffect(() => {
    setSeoData({
      meta_title: data.seo?.meta_title || '',
      meta_description: data.seo?.meta_description || '',
      slug: data.seo?.slug || '',
      focus_keyword: data.seo?.focus_keyword || '',
    });
    setMetadata({
      excerpt: data.metadata?.excerpt || '',
      categories: data.metadata?.categories || [],
      tags: data.metadata?.tags || [],
      featured_image_alt: data.metadata?.featured_image_alt || '',
      author: data.metadata?.author || '',
    });
  }, [output.id]);

  // Update SEO data in database
  const handleUpdateSEO = async (updates: Partial<typeof seoData>) => {
    // Update local state immediately for responsive UI
    const newSEO = { ...seoData, ...updates };
    setSeoData(newSEO);

    try {
      const newData = { ...data, seo: newSEO };

      const { error } = await supabase
        .from('content_outputs')
        .update({ data: newData })
        .eq('id', output.id);

      if (error) throw error;

      // Update the output object for consistency
      output.data = newData;
    } catch (err) {
      console.error('Failed to update SEO:', err);
      toast.error('Failed to save SEO changes');
    }
  };

  // Update metadata in database
  const handleUpdateMetadata = async (updates: Partial<typeof metadata>) => {
    // Update local state immediately for responsive UI
    const newMetadata = { ...metadata, ...updates };
    setMetadata(newMetadata);

    try {
      const newData = { ...data, metadata: newMetadata };

      const { error } = await supabase
        .from('content_outputs')
        .update({ data: newData })
        .eq('id', output.id);

      if (error) throw error;

      output.data = newData;
    } catch (err) {
      console.error('Failed to update metadata:', err);
      toast.error('Failed to save metadata changes');
    }
  };

  // Build article data for export/publish
  const articleData = useMemo(() => ({
    title,
    text: textContent,
    image_url: imageUrl,
    seo: seoData,
    metadata,
  }), [title, textContent, imageUrl, seoData, metadata]);

  // Check if SEO is incomplete
  const hasSEOIssues = !seoData.meta_title || !seoData.meta_description || !seoData.slug;

  // Build available content for save dialog
  const getAvailableContentForSave = (): SaveableContent[] => {
    const content: SaveableContent[] = [];

    if (textContent) {
      content.push({
        id: 'article-text',
        contentType: 'text',
        content: { text: textContent },
        suggestedName: title || 'Article Content',
        sourceStage: 'text',
        preview: textContent.substring(0, 150) + (textContent.length > 150 ? '...' : ''),
      });
    }
    if (imageUrl) {
      content.push({
        id: 'article-image',
        contentType: 'image',
        content: { url: imageUrl },
        suggestedName: `${title || 'Article'} - Featured Image`,
        sourceStage: 'image',
        thumbnailUrl: imageUrl,
      });
    }

    return content;
  };

  const statusConfig = getStatusConfig(output.status);
  const StatusIcon = statusConfig.icon;

  return (
    <div className="h-full flex flex-col overflow-hidden bg-gradient-to-br from-background via-background to-muted/20">
      {/* Enhanced Header */}
      <div className="flex-shrink-0 px-6 py-4 border-b bg-background/80 backdrop-blur-sm">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0 flex-1">
            <h3 className="text-lg font-semibold truncate">{title}</h3>
            {metadataLabel && (
              <span className="text-xs px-2.5 py-1 rounded-lg bg-muted text-muted-foreground shrink-0 font-medium border border-border/50">
                {metadataLabel}
              </span>
            )}
            <Badge variant="outline" className={cn("gap-1.5 px-2.5 py-1 rounded-lg font-medium", statusConfig.className)}>
              <StatusIcon className={cn("h-3.5 w-3.5", statusConfig.loading && "animate-spin")} />
              {statusConfig.label}
            </Badge>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <div className="flex items-center gap-2 text-sm text-muted-foreground px-3 py-1.5 bg-muted/50 rounded-lg">
              <FileText className="h-3.5 w-3.5" />
              <span className="font-medium tabular-nums">{wordCount.toLocaleString()}</span>
              <span>words</span>
              <span className="text-muted-foreground/40">•</span>
              <span className="font-medium tabular-nums">{readingTime}</span>
              <span>min read</span>
            </div>
            <div className="flex items-center gap-1 p-1 bg-muted/50 rounded-lg">
              <Button
                variant="ghost"
                size="icon"
                onClick={onPrevious}
                disabled={currentIndex === 0}
                className="h-8 w-8 rounded-md"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm text-muted-foreground whitespace-nowrap px-2 font-medium tabular-nums">
                {currentIndex + 1} / {totalCount}
              </span>
              <Button
                variant="ghost"
                size="icon"
                onClick={onNext}
                disabled={currentIndex === totalCount - 1}
                className="h-8 w-8 rounded-md"
              >
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Enhanced Tabs Navigation */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-shrink-0 px-6 border-b bg-muted/20">
          <TabsList className="h-12 bg-transparent p-0 gap-1">
            <TabsTrigger
              value="content"
              className="data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-t-lg px-4 gap-2"
            >
              <FileText className="h-4 w-4" />
              Content
            </TabsTrigger>
            <TabsTrigger
              value="featured-image"
              className="data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-t-lg px-4 gap-2"
            >
              <Image className="h-4 w-4" />
              Featured Image
              {imageUrl && (
                <span className="h-2 w-2 rounded-full bg-green-500" />
              )}
            </TabsTrigger>
            <TabsTrigger
              value="seo"
              className="data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-t-lg px-4 gap-2"
            >
              <Search className="h-4 w-4" />
              SEO
              {hasSEOIssues && (
                <span className="h-2 w-2 rounded-full bg-amber-500" />
              )}
            </TabsTrigger>
            <TabsTrigger
              value="metadata"
              className="data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-t-lg px-4 gap-2"
            >
              <Settings className="h-4 w-4" />
              Metadata
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto">
          <TabsContent value="content" className="m-0 h-full">
            <div className="max-w-4xl mx-auto p-6">
              <TextContentSection
                content={textContent}
                onUpdate={onUpdateText}
                onRegenerate={onRegenerateText}
                isRegenerating={isRegeneratingText}
                contentLabel="Article"
              />
            </div>
          </TabsContent>

          <TabsContent value="featured-image" className="m-0 h-full">
            <div className="max-w-4xl mx-auto p-6">
              <div className="space-y-4">
                <div>
                  <h3 className="text-lg font-medium mb-1">Featured Image</h3>
                  <p className="text-sm text-muted-foreground">
                    Add a featured image for your article. This will be displayed as the thumbnail and header image.
                  </p>
                </div>
                <ImageContentSection
                  imageUrl={imageUrl}
                  imagePrompt={imagePrompt}
                  onGenerateImage={onGenerateImage}
                  onRegenerateImage={onRegenerateImage}
                  onUpdateImage={onUpdateImage}
                  isGenerating={isGeneratingImage}
                  isRequired={false}
                />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="seo" className="m-0 h-full">
            <div className="max-w-2xl mx-auto p-6">
              <SEOMetadataEditor
                seoData={seoData}
                articleTitle={title}
                onUpdate={handleUpdateSEO}
              />
            </div>
          </TabsContent>

          <TabsContent value="metadata" className="m-0 h-full">
            <div className="max-w-2xl mx-auto p-6">
              <ArticleMetadataEditor
                metadata={metadata}
                onUpdate={handleUpdateMetadata}
                wordCount={wordCount}
                readingTime={readingTime}
              />
            </div>
          </TabsContent>
        </div>
      </Tabs>

      {/* Enhanced Sticky Footer */}
      <div className="flex-shrink-0 px-6 py-4 border-t bg-background/95 backdrop-blur-sm shadow-[0_-4px_20px_rgba(0,0,0,0.05)]">
        <div className="flex items-center justify-between">
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onDelete} className="text-muted-foreground hover:text-destructive">
              <Trash2 className="h-4 w-4 mr-1.5" />
              Delete
            </Button>
            {onCopy && (
              <Button variant="ghost" size="sm" onClick={onCopy} className="text-muted-foreground">
                <Copy className="h-4 w-4 mr-1.5" />
                Copy
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => setShowSaveDialog(true)} className="text-muted-foreground">
              <Bookmark className="h-4 w-4 mr-1.5" />
              Save to Library
            </Button>
          </div>
          <div className="flex gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={onReject}
              className="border-red-500/30 text-red-600 hover:bg-red-500/10 hover:text-red-700 dark:text-red-400"
            >
              <XCircle className="h-4 w-4 mr-1.5" />
              Reject
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onApprove}
              className="border-green-500/30 text-green-600 hover:bg-green-500/10 hover:text-green-700 dark:text-green-400"
            >
              <CheckCircle2 className="h-4 w-4 mr-1.5" />
              Approve
            </Button>

            {/* Publish Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="cta" size="sm" className="shadow-md hover:shadow-lg transition-all">
                  <Download className="h-4 w-4 mr-1.5" />
                  Publish
                  <ChevronDown className="h-4 w-4 ml-1.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem onClick={() => setShowWordPressDialog(true)}>
                  <Globe className="h-4 w-4 mr-2" />
                  Publish to WordPress
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setShowExportDialog(true)}>
                  <Download className="h-4 w-4 mr-2" />
                  Export (HTML/MD/JSON)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      {/* Dialogs */}
      <ExportArticleDialog
        open={showExportDialog}
        onOpenChange={setShowExportDialog}
        articleData={articleData}
      />

      <WordPressPublishDialog
        open={showWordPressDialog}
        onOpenChange={setShowWordPressDialog}
        articleData={articleData}
        outputId={output.id}
      />

      <SaveContentMultiDialog
        open={showSaveDialog}
        onOpenChange={setShowSaveDialog}
        availableContent={getAvailableContentForSave()}
        sourceOutputId={output.id}
        sourceJobId={output.job_id}
        outputTitle={title}
      />
    </div>
  );
}
