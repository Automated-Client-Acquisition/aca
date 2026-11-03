import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { CalendarIcon, Send, Loader2, ChevronDown, Bookmark, Plus, Trash2, ListOrdered } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { format, startOfDay } from "date-fns";
import { cn } from "@/lib/utils";
import { usePushToGHL } from "@/hooks/usePushToGHL";
import { useGHLAccounts, type GHLAccount } from "@/hooks/useGHLAccounts";
import { useTwitterAccounts } from "@/hooks/useTwitterAccounts";
import { useGenerateVideoCaption } from "@/hooks/useGenerateVideoCaption";
import { useAuth } from "@/contexts/AuthContext";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PlatformContent } from "@/types/publishing";
import { PostPreview } from "./PostPreview";
import { ProfileSelector } from "./ProfileSelector";
import { RichTextToolbar } from "./RichTextToolbar";
import { FollowUpComment } from "./FollowUpComment";
import { AdvancedOptions } from "./AdvancedOptions";
import { PlatformContentEditor } from "./PlatformContentEditor";
import { PostTypeSelector } from "./PostTypeSelector";
import { TagInput } from "./TagInput";
import { MultiImageGallery } from "./viewers/MultiImageGallery";
import { VideoUpload } from "./VideoUpload";
import { PLATFORMS } from "@/lib/platformRequirements";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { SavedContentPicker } from "@/components/saved-content/SavedContentPicker";
import type { SavedContent, TextContentData, ImageContentData, VideoContentData } from "@/types/savedContent";

interface PushToGHLDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  outputId: string;
  outputTitle: string;
  outputData: any;
}

export function PushToGHLDialog({
  open,
  onOpenChange,
  outputId,
  outputTitle,
  outputData,
}: PushToGHLDialogProps) {
  const queryClient = useQueryClient();
  const { user, currentOrganization } = useAuth();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [customizePerChannel, setCustomizePerChannel] = useState(false);
  const [scheduleDate, setScheduleDate] = useState<Date>();
  const [scheduleTime, setScheduleTime] = useState<string>("12:00");
  const [followUpComment, setFollowUpComment] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedOrgTags, setSelectedOrgTags] = useState<string[]>([]);
  const [showSchedulePicker, setShowSchedulePicker] = useState(false);
  const [activeEditorTab, setActiveEditorTab] = useState<string>("all");
  const [showTextPicker, setShowTextPicker] = useState(false);
  const [showMediaPicker, setShowMediaPicker] = useState(false);

  // Thread mode state (Twitter/X only)
  const [threadMode, setThreadMode] = useState(false);
  const [threadTweets, setThreadTweets] = useState<string[]>(["", ""]);

  // Use currentOrganization from AuthContext - it already respects impersonation
  const organizationId = currentOrganization?.id;

  // Validate that selected schedule date/time is in the future
  const isScheduleInPast = useMemo(() => {
    if (!scheduleDate || !scheduleTime) return false;
    const [h, m] = scheduleTime.split(':');
    const combined = new Date(scheduleDate);
    combined.setHours(parseInt(h), parseInt(m), 0, 0);
    return combined <= new Date();
  }, [scheduleDate, scheduleTime]);

  // Extract nested data
  const nestedData = outputData?.data || {};
  const stageData = (outputData?.stage_data as any) || {};
  const isSocialMediaPost = outputData?.pipeline === 'social_media_post';
  const isVideoPipeline = outputData?.pipeline === 'generative_video_oneshot';
  const isCarouselPipeline = outputData?.pipeline === 'instagram_carousel' || outputData?.pipeline === 'instagram_carousel_ai';

  // For social_media_post pipeline, content is in stage_data.caption and stage_data.image
  const socialMediaCaption = stageData?.caption?.content;
  const socialMediaImage = stageData?.image?.url || stageData?.image?.image_url;

  // For instagram_carousel pipeline, extract carousel slides images and caption
  const carouselCaption = stageData?.caption?.content;
  const carouselSlides = stageData?.carousel_slides?.slides || [];

  const finalVideoUrl = stageData?.final?.url || outputData?.videoUrl || outputData?.video_url || nestedData?.videoUrl || nestedData?.video_url;
  const captionFromStage = stageData?.final?.caption || carouselCaption || socialMediaCaption;

  // Extract storyboard images for video pipelines
  const storyboardImages = useMemo(() => {
    const storyboard = stageData?.storyboard;
    if (!storyboard?.scenes) return [];
    return storyboard.scenes
      .filter((scene: any) => scene.image_url)
      .map((scene: any) => scene.image_url);
  }, [stageData?.storyboard]);

  // Extract carousel slide images for instagram_carousel pipeline
  // Include all slides with images (approved preferred, but fall back to any with images)
  const carouselImages = useMemo(() => {
    if (!carouselSlides || carouselSlides.length === 0) return [];
    const approvedSlides = carouselSlides.filter((slide: any) => slide.image_url && slide.status === 'approved');
    const slidesWithImages = approvedSlides.length > 0
      ? approvedSlides
      : carouselSlides.filter((slide: any) => slide.image_url);
    return slidesWithImages
      .sort((a: any, b: any) => (a.slide_number || 0) - (b.slide_number || 0))
      .map((slide: any) => slide.image_url);
  }, [carouselSlides]);

  // Get images from all possible locations
  const getImages = () => {
    // For instagram_carousel, prioritize carousel slide images
    if (isCarouselPipeline && carouselImages.length > 0) return carouselImages;
    // For social_media_post, prioritize the image from stage_data
    if (isSocialMediaPost && socialMediaImage) return [socialMediaImage];
    if (outputData?.images?.length > 0) return outputData.images;
    if (outputData?.imageUrl) return [outputData.imageUrl];
    if (outputData?.image_url) return [outputData.image_url];
    if (nestedData?.images?.length > 0) return nestedData.images;
    if (nestedData?.imageUrl) return [nestedData.imageUrl];
    if (nestedData?.image_url) return [nestedData.image_url];
    if (isVideoPipeline && storyboardImages.length > 0) return storyboardImages;
    return [];
  };

  const initialImages = getImages();

  // Base content state
  const [baseContent, setBaseContent] = useState<PlatformContent>({
    caption: captionFromStage || outputData?.text || outputData?.content || nestedData?.text || nestedData?.content || "",
    images: initialImages.length > 0 ? initialImages : storyboardImages,
    videoUrl: finalVideoUrl,
    videoThumbnail: outputData?.videoThumbnail || outputData?.video_thumbnail || nestedData?.videoThumbnail || nestedData?.video_thumbnail || storyboardImages[0],
    tags: [],
    postType: finalVideoUrl ? 'video' : 'feed',
  });

  const [platformOverrides, setPlatformOverrides] = useState<Record<string, Partial<PlatformContent>>>({});

  const pushToGHL = usePushToGHL();
  const { data: accountsData, isLoading: loadingGHL, error: accountsError } = useGHLAccounts();
  const { data: twitterAccounts, isLoading: loadingTwitter } = useTwitterAccounts();
  const generateCaption = useGenerateVideoCaption();
  const [twitterPublishing, setTwitterPublishing] = useState(false);

  const loadingAccounts = loadingGHL || loadingTwitter;

  // Transform Twitter accounts to GHLAccount shape so ProfileSelector can use them
  const twitterAsGHL: GHLAccount[] = (twitterAccounts || [])
    .filter(a => a.is_active && a.is_valid)
    .map(a => ({
      id: a.id,
      type: 'twitter',
      name: a.name,
      username: a.twitter_handle || undefined,
      profileImage: a.profile_image_url || undefined,
      isActive: true,
    }));

  // Set of Twitter account IDs for quick lookup during publish
  const twitterAccountIds = new Set(twitterAsGHL.map(a => a.id));

  // Track if we've initialized content for this dialog session
  const [hasInitialized, setHasInitialized] = useState(false);
  const [lastOutputId, setLastOutputId] = useState<string | null>(null);

  // Reset initialization flag when dialog closes or outputId changes
  useEffect(() => {
    if (!open) {
      setHasInitialized(false);
    }
  }, [open]);

  // Reset initialization when outputId changes (switching between outputs)
  useEffect(() => {
    if (outputId !== lastOutputId) {
      setHasInitialized(false);
      setLastOutputId(outputId);
    }
  }, [outputId, lastOutputId]);

  // Sync content ONLY when dialog first opens (not on every dependency change)
  useEffect(() => {
    if (open && !hasInitialized) {
      const currentNestedData = outputData?.data || {};
      const currentStageData = (outputData?.stage_data as any) || {};

      // For social_media_post, get caption and image from stage_data
      const socialCaption = currentStageData?.caption?.content;
      const socialImage = currentStageData?.image?.url || currentStageData?.image?.image_url;

      // For instagram_carousel, get caption from stage_data
      const currentCarouselCaption = currentStageData?.caption?.content;

      const newVideoUrl = currentStageData?.final?.url || outputData?.videoUrl || outputData?.video_url || currentNestedData?.videoUrl || currentNestedData?.video_url;
      const newCaption = currentStageData?.final?.caption || currentCarouselCaption || socialCaption || outputData?.text || outputData?.content || currentNestedData?.text || currentNestedData?.content || "";

      const newImages = (() => {
        // For instagram_carousel, prioritize carousel slide images
        if (isCarouselPipeline && carouselImages.length > 0) return carouselImages;
        // For social_media_post, prioritize the image from stage_data
        if (isSocialMediaPost && socialImage) return [socialImage];
        if (outputData?.images?.length > 0) return outputData.images;
        if (outputData?.imageUrl) return [outputData.imageUrl];
        if (outputData?.image_url) return [outputData.image_url];
        if (currentNestedData?.images?.length > 0) return currentNestedData.images;
        if (currentNestedData?.imageUrl) return [currentNestedData.imageUrl];
        if (currentNestedData?.image_url) return [currentNestedData.image_url];
        if (isVideoPipeline && storyboardImages.length > 0) return storyboardImages;
        return [];
      })();

      // For carousel, default to 'carousel' post type if multiple images
      const defaultPostType = newVideoUrl ? 'video' :
        (isCarouselPipeline && newImages.length > 1) ? 'carousel' : 'feed';

      setBaseContent(prev => ({
        ...prev,
        caption: newCaption || prev.caption,
        videoUrl: newVideoUrl || prev.videoUrl,
        images: newImages.length > 0 ? newImages : prev.images,
        videoThumbnail: outputData?.videoThumbnail || outputData?.video_thumbnail || currentNestedData?.videoThumbnail || currentNestedData?.video_thumbnail || storyboardImages[0] || prev.videoThumbnail,
        postType: defaultPostType,
      }));

      setHasInitialized(true);
    }
  }, [open, hasInitialized, outputData, stageData, storyboardImages, carouselImages, isVideoPipeline, isSocialMediaPost, isCarouselPipeline]);

  // Handle AI caption generation
  const handleGenerateCaption = async () => {
    const params = outputData?.generation_params || {};

    await generateCaption.mutateAsync({
      outputId,
      ideaContext: outputData?.content_ideas?.title,
      scenePrompts: stageData?.scene_prompts?.scenes,
      libraryContext: {
        brandVoice: params?.brand_voice,
        product: params?.product,
        angle: params?.block,
      },
    });

    const { data } = await supabase
      .from('content_outputs')
      .select('stage_data')
      .eq('id', outputId)
      .single();

    if (data) {
      const newCaption = (data.stage_data as any)?.final?.caption;
      if (newCaption) {
        setBaseContent(prev => ({ ...prev, caption: newCaption }));
      }
    }

    queryClient.invalidateQueries({ queryKey: ['content-outputs'] });
  };

  // Handle selecting saved text content
  const handleSelectSavedText = (item: SavedContent) => {
    if (item.content_type === 'text') {
      const text = (item.content as TextContentData).text || '';
      setBaseContent(prev => ({ ...prev, caption: text }));
    }
  };

  // Handle selecting saved media content
  const handleSelectSavedMedia = (item: SavedContent) => {
    if (item.content_type === 'image') {
      const imageUrl = (item.content as ImageContentData).url;
      if (imageUrl) {
        setBaseContent(prev => ({
          ...prev,
          images: [...prev.images, imageUrl]
        }));
      }
    } else if (item.content_type === 'video') {
      const videoUrl = (item.content as VideoContentData).url;
      const thumbnail = (item.content as VideoContentData).thumbnail_url;
      if (videoUrl) {
        setBaseContent(prev => ({
          ...prev,
          videoUrl,
          videoThumbnail: thumbnail || prev.videoThumbnail,
          postType: 'video'
        }));
      }
    }
  };

  // Initialize platform overrides when customization is enabled
  useEffect(() => {
    if (customizePerChannel && selectedAccounts.length > 0) {
      const uniquePlatforms = new Set(
        selectedAccounts
          .map(accountId => {
            const account = activeAccounts.find(a => a.id === accountId);
            return account?.type.toLowerCase();
          })
          .filter(Boolean) as string[]
      );

      const newOverrides: Record<string, Partial<PlatformContent>> = {};
      uniquePlatforms.forEach(platformId => {
        if (!platformOverrides[platformId]) {
          const platform = PLATFORMS[platformId];
          let defaultPostType = platform?.postTypes[0] || 'post';
          if (finalVideoUrl) {
            if (platformId === 'instagram') defaultPostType = 'reel';
            else if (platformId === 'youtube') defaultPostType = 'short';
            else if (platformId === 'tiktok') defaultPostType = 'video';
          }
          newOverrides[platformId] = { postType: defaultPostType };
        } else {
          newOverrides[platformId] = platformOverrides[platformId];
        }
      });

      setPlatformOverrides(newOverrides);
    } else {
      setPlatformOverrides({});
    }
  }, [customizePerChannel, selectedAccounts, finalVideoUrl]);

  const handleAccountToggle = (accountId: string) => {
    setSelectedAccounts(prev =>
      prev.includes(accountId)
        ? prev.filter(id => id !== accountId)
        : [...prev, accountId]
    );
  };

  const handleSelectAll = () => {
    setSelectedAccounts(activeAccounts.map(a => a.id));
  };

  const handleClearAll = () => {
    setSelectedAccounts([]);
  };

  // Insert text at cursor position
  const handleInsertText = (text: string, wrapWith?: { before: string; after: string }) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = baseContent.caption.substring(start, end);

    let newText: string;
    let newCursorPos: number;

    if (wrapWith) {
      newText = baseContent.caption.substring(0, start) +
        wrapWith.before + selectedText + wrapWith.after +
        baseContent.caption.substring(end);
      newCursorPos = start + wrapWith.before.length + selectedText.length + wrapWith.after.length;
    } else {
      newText = baseContent.caption.substring(0, start) + text + baseContent.caption.substring(end);
      newCursorPos = start + text.length;
    }

    setBaseContent(prev => ({ ...prev, caption: newText }));

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(newCursorPos, newCursorPos);
    }, 0);
  };

  const handlePush = async (scheduled: boolean = false) => {
    if (selectedAccounts.length === 0) return;

    let scheduleDateISO: string | undefined;
    if (scheduled && scheduleDate && scheduleTime) {
      const [hours, minutes] = scheduleTime.split(':');
      const combined = new Date(scheduleDate);
      combined.setHours(parseInt(hours), parseInt(minutes), 0, 0);
      scheduleDateISO = combined.toISOString();
    }

    // Append hashtags to caption for publishing
    const appendHashtags = (caption: string, tags: string[]) => {
      if (tags.length === 0) return caption;
      const hashtagString = tags.join(' ');
      return caption.trim() + '\n\n' + hashtagString;
    };

    // Prepare base content with hashtags appended
    const finalBaseContent = {
      ...baseContent,
      caption: appendHashtags(baseContent.caption, baseContent.tags),
    };

    // Prepare platform overrides with hashtags appended
    const finalPlatformOverrides: Record<string, Partial<PlatformContent>> = {};
    Object.entries(platformOverrides).forEach(([platformId, override]) => {
      const caption = override.caption ?? baseContent.caption;
      const tags = override.tags ?? baseContent.tags;
      finalPlatformOverrides[platformId] = {
        ...override,
        caption: appendHashtags(caption, tags),
      };
    });

    // Split accounts: GHL vs Twitter
    const ghlAccountIds = selectedAccounts.filter(id => !twitterAccountIds.has(id));
    const twitterIds = selectedAccounts.filter(id => twitterAccountIds.has(id));

    // Publish to GHL accounts (facebook, instagram, linkedin, etc.)
    if (ghlAccountIds.length > 0) {
      await pushToGHL.mutateAsync({
        contentOutputIds: outputId,
        platforms: ghlAccountIds,
        scheduleDate: scheduleDateISO,
        baseContent: finalBaseContent,
        customizePerChannel,
        platformOverrides: finalPlatformOverrides,
      });
    }

    // Publish to Twitter accounts directly via publish-to-twitter
    if (twitterIds.length > 0) {
      setTwitterPublishing(true);
      try {
        // Build media URLs from content
        const mediaUrls: string[] = [];
        if (finalBaseContent.videoUrl) {
          mediaUrls.push(finalBaseContent.videoUrl);
        } else if (finalBaseContent.images?.length > 0) {
          mediaUrls.push(...finalBaseContent.images.slice(0, 4)); // Twitter max 4 images
        }

        // Get the twitter-specific caption if customized, else use base
        const twitterOverride = finalPlatformOverrides['twitter'];
        const tweetText = twitterOverride?.caption || finalBaseContent.caption || '';

        // Build thread payload if thread mode is active
        const threadPayload = (threadMode && onlyTwitterSelected)
          ? threadTweets.filter(t => t.trim()).map(text => ({ text }))
          : undefined;

        for (const accountId of twitterIds) {
          await supabase.functions.invoke('publish-to-twitter', {
            body: {
              account_id: accountId,
              tweet: {
                text: tweetText,
                media_urls: mediaUrls.length > 0 ? mediaUrls : undefined,
              },
              thread: threadPayload && threadPayload.length > 1 ? threadPayload : undefined,
              output_id: outputId,
              schedule_date: scheduleDateISO,
            },
          });
        }
      } finally {
        setTwitterPublishing(false);
      }
    }

    onOpenChange(false);
    setSelectedAccounts([]);
    setScheduleDate(undefined);
    setFollowUpComment("");
    setSelectedCategory(null);
    setSelectedOrgTags([]);
  };

  const accounts = [...(accountsData?.accounts || []), ...twitterAsGHL];
  const activeAccounts = accounts.filter(a => a.isActive);

  const selectedPlatformIds = Array.from(new Set(
    selectedAccounts
      .map(accountId => {
        const account = activeAccounts.find(a => a.id === accountId);
        return account?.type.toLowerCase();
      })
      .filter(Boolean) as string[]
  ));

  const hasImage = baseContent.images.length > 0;
  const hasVideo = !!baseContent.videoUrl;
  const hasInstagramWithoutImage = selectedPlatformIds.includes('instagram') && !hasImage && !hasVideo;
  const hasYoutubeWithoutVideo = (selectedPlatformIds.includes('youtube') || selectedPlatformIds.includes('tiktok')) && !hasVideo;
  const showInstagramOptions = selectedPlatformIds.includes('instagram');

  // Show thread toggle when at least one Twitter account is selected
  const hasTwitterSelected = selectedAccounts.some(id => twitterAccountIds.has(id));
  const onlyTwitterSelected = selectedAccounts.length > 0 && selectedAccounts.every(id => twitterAccountIds.has(id));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl flex flex-col h-[90vh] overflow-hidden p-0">
        <DialogHeader className="shrink-0 px-6 pt-6 pb-4 border-b">
          <DialogTitle>Create Post</DialogTitle>
          <DialogDescription>
            Publish "{outputTitle}" to your connected social media accounts
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 flex overflow-hidden">
          {/* Left Column - Editor */}
          <div className="flex-1 border-r flex flex-col">
            <ScrollArea className="flex-1">
              <div className="p-6 space-y-6">
                {/* Profile Selector */}
                {loadingAccounts ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : accountsError ? (
                  <Alert variant="destructive">
                    <AlertDescription>
                      Failed to load connected accounts. Please check your GHL connection.
                    </AlertDescription>
                  </Alert>
                ) : accountsData?.needsOAuth || accountsData?.needsReconnect ? (
                  <Alert>
                    <AlertDescription className="space-y-3">
                      <p>
                        {accountsData.needsReconnect
                          ? "Your LeadConnector connection needs to be refreshed."
                          : "LeadConnector is not connected."}
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => window.location.href = '/settings?tab=integrations'}
                      >
                        {accountsData.needsReconnect ? 'Reconnect' : 'Connect'} in Settings
                      </Button>
                    </AlertDescription>
                  </Alert>
                ) : (
                  <ProfileSelector
                    accounts={activeAccounts}
                    selectedAccounts={selectedAccounts}
                    onAccountToggle={handleAccountToggle}
                    onSelectAll={handleSelectAll}
                    onClearAll={handleClearAll}
                    customizePerChannel={customizePerChannel}
                    onCustomizeChange={setCustomizePerChannel}
                    isLoading={loadingAccounts}
                    onPlatformClick={(platformId) => {
                      // Enable customization and switch to that platform's content
                      if (!customizePerChannel) {
                        setCustomizePerChannel(true);
                      }
                      setActiveEditorTab(platformId);
                    }}
                    activePlatform={customizePerChannel ? activeEditorTab : null}
                  />
                )}

                <Separator />

                {/* Thread mode toggle — shown when Twitter accounts are selected */}
                {hasTwitterSelected && onlyTwitterSelected && (
                  <div className="flex items-center justify-between rounded-lg border px-4 py-3 bg-muted/30">
                    <div className="flex items-center gap-2">
                      <ListOrdered className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium">Thread mode</p>
                        <p className="text-xs text-muted-foreground">Chain multiple tweets as a thread</p>
                      </div>
                    </div>
                    <Switch
                      checked={threadMode}
                      onCheckedChange={(checked) => {
                        setThreadMode(checked);
                        if (checked && threadTweets.length < 2) {
                          setThreadTweets(["", ""]);
                        }
                      }}
                    />
                  </div>
                )}

                {/* Thread composer */}
                {threadMode && onlyTwitterSelected && (
                  <div className="space-y-3">
                    <Label className="text-sm font-medium">Thread tweets</Label>
                    {threadTweets.map((tweet, index) => {
                      const charCount = tweet.length;
                      const isOver = charCount > 280;
                      return (
                        <div key={index} className="space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-muted-foreground">Tweet {index + 1}</span>
                            <div className="flex items-center gap-2">
                              <span className={`text-xs ${isOver ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>
                                {charCount}/280
                              </span>
                              {threadTweets.length > 2 && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-5 w-5"
                                  onClick={() => setThreadTweets(prev => prev.filter((_, i) => i !== index))}
                                >
                                  <Trash2 className="h-3 w-3 text-muted-foreground" />
                                </Button>
                              )}
                            </div>
                          </div>
                          <Textarea
                            value={tweet}
                            onChange={(e) => setThreadTweets(prev => prev.map((t, i) => i === index ? e.target.value : t))}
                            placeholder={index === 0 ? "Hook — the first tweet in your thread..." : `Tweet ${index + 1}...`}
                            rows={3}
                            className={`resize-none ${isOver ? 'border-destructive focus-visible:ring-destructive' : ''}`}
                          />
                        </div>
                      );
                    })}
                    {threadTweets.length < 10 && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={() => setThreadTweets(prev => [...prev, ""])}
                      >
                        <Plus className="h-3.5 w-3.5 mr-1.5" />
                        Add tweet
                      </Button>
                    )}
                  </div>
                )}

                {/* Content Editor — hidden when thread mode is active for Twitter-only selection */}
                {(!threadMode || !onlyTwitterSelected) && (customizePerChannel && Object.keys(platformOverrides).length > 0 ? (
                  <PlatformContentEditor
                    baseContent={baseContent}
                    platformOverrides={platformOverrides}
                    selectedPlatforms={selectedPlatformIds}
                    onUpdateBaseContent={(updates) => setBaseContent(prev => ({ ...prev, ...updates }))}
                    onUpdatePlatformOverride={(platformId, updates) => {
                      setPlatformOverrides(prev => ({
                        ...prev,
                        [platformId]: { ...prev[platformId], ...updates }
                      }));
                    }}
                    activePlatform={activeEditorTab}
                  />
                ) : (
                  <div className="space-y-4">
                    {/* Post Type Selector - show for the first platform with multiple types */}
                    {(() => {
                      const platformWithMultipleTypes = selectedPlatformIds.find(
                        platformId => PLATFORMS[platformId]?.postTypes.length > 1
                      );
                      if (platformWithMultipleTypes) {
                        return (
                          <PostTypeSelector
                            platformId={platformWithMultipleTypes}
                            selectedType={baseContent.postType}
                            onTypeChange={(type) => setBaseContent(prev => ({ ...prev, postType: type }))}
                            hasImage={hasImage}
                            hasVideo={hasVideo}
                          />
                        );
                      }
                      return null;
                    })()}

                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <Label className="text-sm font-medium">Type content</Label>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setShowTextPicker(true)}
                          className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
                        >
                          <Bookmark className="h-3.5 w-3.5" />
                          Use from Library
                        </Button>
                      </div>

                      <Textarea
                        ref={textareaRef}
                        value={baseContent.caption}
                        onChange={(e) => setBaseContent(prev => ({ ...prev, caption: e.target.value }))}
                        placeholder="Write your post here..."
                        rows={10}
                        className="resize-none"
                      />

                      <RichTextToolbar
                        onAIGenerate={handleGenerateCaption}
                        onInsertText={handleInsertText}
                        onEmojiSelect={(emoji) => handleInsertText(emoji)}
                        isAIGenerating={generateCaption.isPending}
                      />
                    </div>

                    {/* Media Section with Library Button */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <Label className="text-sm font-medium">Media</Label>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setShowMediaPicker(true)}
                          className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
                        >
                          <Bookmark className="h-3.5 w-3.5" />
                          Use from Library
                        </Button>
                      </div>

                      {/* Images */}
                      <MultiImageGallery
                        images={baseContent.images}
                        onUpdateImages={(images) => setBaseContent(prev => ({ ...prev, images }))}
                        outputId={outputId}
                      />

                      {/* Video */}
                      <VideoUpload
                        videoUrl={baseContent.videoUrl}
                        videoThumbnail={baseContent.videoThumbnail}
                        onUpdateVideo={(videoUrl, thumbnail) => setBaseContent(prev => ({
                          ...prev,
                          videoUrl,
                          videoThumbnail: thumbnail || prev.videoThumbnail,
                          postType: videoUrl ? 'video' : prev.postType
                        }))}
                      />
                    </div>

                    {/* Hashtags */}
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Hashtags</Label>
                      <TagInput
                        tags={baseContent.tags}
                        onTagsChange={(tags) => setBaseContent(prev => ({ ...prev, tags }))}
                        placeholder="Add hashtags..."
                      />
                    </div>
                  </div>
                ))}

                {/* Follow-up Comment */}
                <FollowUpComment
                  comment={followUpComment}
                  onChange={setFollowUpComment}
                />

                {/* Advanced Options */}
                <AdvancedOptions
                  selectedCategory={selectedCategory}
                  onCategoryChange={setSelectedCategory}
                  selectedTags={selectedOrgTags}
                  onTagsChange={setSelectedOrgTags}
                  showInstagramOptions={showInstagramOptions}
                  postType={baseContent.postType}
                  onPostTypeChange={(type) => setBaseContent(prev => ({ ...prev, postType: type }))}
                  hasVideo={hasVideo}
                  hasImage={hasImage}
                  organizationId={organizationId}
                />

                {/* Platform Requirement Warnings */}
                {hasInstagramWithoutImage && (
                  <Alert variant="destructive">
                    <AlertDescription>
                      <strong>Instagram requires an image or video.</strong> Please add media before publishing to Instagram.
                    </AlertDescription>
                  </Alert>
                )}

                {hasYoutubeWithoutVideo && (
                  <Alert variant="destructive">
                    <AlertDescription>
                      <strong>YouTube/TikTok requires a video.</strong> Please add a video before publishing.
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            </ScrollArea>
          </div>

          {/* Right Column - Preview */}
          <div className="w-[480px] bg-muted/30">
            <PostPreview
              baseContent={baseContent}
              platformOverrides={customizePerChannel ? platformOverrides : {}}
              selectedPlatforms={selectedPlatformIds}
              accounts={activeAccounts}
              selectedAccountIds={selectedAccounts}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 shrink-0 px-6 py-4 border-t bg-background">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                disabled={
                  selectedAccounts.length === 0 ||
                  pushToGHL.isPending ||
                  twitterPublishing ||
                  loadingAccounts ||
                  hasInstagramWithoutImage ||
                  hasYoutubeWithoutVideo
                }
                className="bg-gradient-aca"
              >
                {(pushToGHL.isPending || twitterPublishing) ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Publishing...
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4 mr-2" />
                    Post
                    <ChevronDown className="h-4 w-4 ml-2" />
                  </>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handlePush(false)}>
                Post Now
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShowSchedulePicker(true)}>
                Schedule
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Schedule Picker Dialog */}
        {showSchedulePicker && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-background rounded-lg p-6 space-y-4 max-w-sm">
              <h3 className="font-semibold">Schedule Post</h3>
              <div className="space-y-3">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !scheduleDate && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {scheduleDate ? format(scheduleDate, "PPP") : "Pick a date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={scheduleDate}
                      onSelect={setScheduleDate}
                      disabled={(date) => date < startOfDay(new Date())}
                    />
                  </PopoverContent>
                </Popover>
                <Input
                  type="time"
                  value={scheduleTime}
                  onChange={(e) => setScheduleTime(e.target.value)}
                />
                {isScheduleInPast && (
                  <p className="text-xs text-destructive">
                    Selected time is in the past. Please choose a future time.
                  </p>
                )}
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setShowSchedulePicker(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    handlePush(true);
                    setShowSchedulePicker(false);
                  }}
                  disabled={!scheduleDate || !scheduleTime || isScheduleInPast}
                >
                  Schedule
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Saved Content Picker - Text */}
        <SavedContentPicker
          open={showTextPicker}
          onOpenChange={setShowTextPicker}
          onSelect={handleSelectSavedText}
          allowedTypes={['text']}
          title="Select Saved Text"
        />

        {/* Saved Content Picker - Media */}
        <SavedContentPicker
          open={showMediaPicker}
          onOpenChange={setShowMediaPicker}
          onSelect={handleSelectSavedMedia}
          allowedTypes={['image', 'video']}
          title="Select Saved Media"
        />
      </DialogContent>
    </Dialog>
  );
}
