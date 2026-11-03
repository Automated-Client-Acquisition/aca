import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { PLATFORMS } from "@/lib/platformRequirements";
import { PlatformContent } from "@/types/publishing";
import { GHLAccount } from "@/hooks/useGHLAccounts";
import { Heart, MessageCircle, Send, Bookmark, ThumbsUp, Share2, MoreHorizontal, Image as ImageIcon } from "lucide-react";
import { FaFacebook, FaInstagram, FaLinkedin, FaYoutube, FaTiktok, FaGoogle } from "react-icons/fa";
import { cn } from "@/lib/utils";

interface PostPreviewProps {
  baseContent: PlatformContent;
  platformOverrides: Record<string, Partial<PlatformContent>>;
  selectedPlatforms: string[];
  accounts?: GHLAccount[];
  selectedAccountIds?: string[];
}

const PLATFORM_ICONS: Record<string, React.ReactNode> = {
  facebook: <FaFacebook className="h-4 w-4" />,
  instagram: <FaInstagram className="h-4 w-4" />,
  linkedin: <FaLinkedin className="h-4 w-4" />,
  youtube: <FaYoutube className="h-4 w-4" />,
  tiktok: <FaTiktok className="h-4 w-4" />,
  google_business: <FaGoogle className="h-4 w-4" />,
  gmb: <FaGoogle className="h-4 w-4" />,
};

const PLATFORM_COLORS: Record<string, string> = {
  facebook: "#1877F2",
  instagram: "#E4405F",
  linkedin: "#0A66C2",
  youtube: "#FF0000",
  tiktok: "#000000",
  google_business: "#4285F4",
  gmb: "#4285F4",
};

export function PostPreview({
  baseContent,
  platformOverrides,
  selectedPlatforms,
  accounts = [],
  selectedAccountIds = []
}: PostPreviewProps) {
  const [activeTab, setActiveTab] = useState<string>("all");

  const getPlatformContent = (platformId: string): PlatformContent => {
    const override = platformOverrides[platformId] || {};
    return {
      caption: override.caption ?? baseContent.caption,
      images: override.images ?? baseContent.images,
      videoUrl: override.videoUrl ?? baseContent.videoUrl,
      videoThumbnail: override.videoThumbnail ?? baseContent.videoThumbnail,
      tags: override.tags ?? baseContent.tags,
      postType: override.postType ?? baseContent.postType,
    };
  };

  // Get account info for a platform - prefer selected accounts
  const getAccountForPlatform = (platformId: string): GHLAccount | undefined => {
    // First try to find a selected account of this platform type
    const selectedAccount = accounts.find(
      a => selectedAccountIds.includes(a.id) && a.type.toLowerCase() === platformId
    );
    if (selectedAccount) return selectedAccount;
    // Fallback to any account of this platform type
    return accounts.find(a => a.type.toLowerCase() === platformId);
  };

  // Get initials from name
  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const renderEmptyMediaState = () => (
    <div className="aspect-video bg-muted/50 flex flex-col items-center justify-center gap-2 text-muted-foreground">
      <ImageIcon className="h-8 w-8" />
      <p className="text-sm text-center px-4">
        Make your post stand out with photos or a video or a GIF
      </p>
    </div>
  );

  const renderInstagramPreview = (content: PlatformContent, account?: GHLAccount) => (
    <Card className="max-w-sm mx-auto bg-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-yellow-400 via-red-500 to-pink-600 p-0.5">
              <Avatar className="h-full w-full border-2 border-white">
                <AvatarImage src={account?.profileImage} alt={account?.name} />
                <AvatarFallback className="text-xs bg-gray-200">
                  {account ? getInitials(account.name) : "IG"}
                </AvatarFallback>
              </Avatar>
            </div>
            <div className="absolute -bottom-0.5 -right-0.5 bg-white rounded-full p-0.5">
              <FaInstagram className="h-3 w-3 text-[#E4405F]" />
            </div>
          </div>
          <div>
            <div className="font-semibold text-sm">{account?.name || "Your Account"}</div>
            <div className="text-xs text-gray-500">JUST NOW</div>
          </div>
        </div>
        <MoreHorizontal className="h-5 w-5 text-gray-500" />
      </div>

      {/* Media */}
      {content.videoUrl ? (
        <div className="aspect-square bg-black">
          <video src={content.videoUrl} controls className="w-full h-full object-contain" />
        </div>
      ) : content.images[0] ? (
        <div className="aspect-square bg-gray-100">
          <img src={content.images[0]} alt="Post" className="w-full h-full object-cover" />
        </div>
      ) : (
        renderEmptyMediaState()
      )}

      {/* Actions */}
      <div className="flex items-center justify-between p-3">
        <div className="flex items-center gap-4">
          <Heart className="h-6 w-6" />
          <MessageCircle className="h-6 w-6" />
          <Send className="h-6 w-6" />
        </div>
        <Bookmark className="h-6 w-6" />
      </div>

      {/* Caption */}
      {(content.caption || content.tags.length > 0) && (
        <div className="px-3 pb-3">
          <div className="text-sm">
            <span className="font-semibold mr-2">{account?.name || "Your Account"}</span>
            <span className="whitespace-pre-wrap">{content.caption}</span>
          </div>
          {content.tags.length > 0 && (
            <div className="text-sm text-blue-600 mt-1">
              {content.tags.join(' ')}
            </div>
          )}
        </div>
      )}
    </Card>
  );

  const renderFacebookPreview = (content: PlatformContent, account?: GHLAccount) => (
    <Card className="max-w-md mx-auto bg-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-3">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Avatar className="h-10 w-10">
              <AvatarImage src={account?.profileImage} alt={account?.name} />
              <AvatarFallback className="bg-blue-100 text-blue-600">
                {account ? getInitials(account.name) : "FB"}
              </AvatarFallback>
            </Avatar>
            <div className="absolute -bottom-0.5 -right-0.5 bg-white rounded-full p-0.5">
              <FaFacebook className="h-3 w-3 text-[#1877F2]" />
            </div>
          </div>
          <div>
            <div className="font-semibold text-sm">{account?.name || "Your Page"}</div>
            <div className="text-xs text-gray-500">JUST NOW · 🌐</div>
          </div>
        </div>
        <MoreHorizontal className="h-5 w-5 text-gray-500" />
      </div>

      {/* Caption */}
      {(content.caption || content.tags.length > 0) && (
        <div className="px-3 pb-3">
          <div className="text-sm whitespace-pre-wrap">{content.caption}</div>
          {content.tags.length > 0 && (
            <div className="text-sm text-blue-600 mt-1">
              {content.tags.join(' ')}
            </div>
          )}
        </div>
      )}

      {/* Media */}
      {content.videoUrl ? (
        <div className="aspect-video bg-black">
          <video src={content.videoUrl} controls className="w-full h-full object-contain" />
        </div>
      ) : content.images[0] ? (
        <div className="bg-gray-100">
          <img src={content.images[0]} alt="Post" className="w-full" />
        </div>
      ) : (
        renderEmptyMediaState()
      )}

      {/* Actions */}
      <div className="flex items-center justify-around p-3 border-t text-sm text-gray-600">
        <button className="flex items-center gap-2 hover:bg-gray-100 px-4 py-2 rounded">
          <ThumbsUp className="h-5 w-5" />
          Like
        </button>
        <button className="flex items-center gap-2 hover:bg-gray-100 px-4 py-2 rounded">
          <MessageCircle className="h-5 w-5" />
          Comment
        </button>
        <button className="flex items-center gap-2 hover:bg-gray-100 px-4 py-2 rounded">
          <Share2 className="h-5 w-5" />
          Share
        </button>
      </div>
    </Card>
  );

  const renderLinkedInPreview = (content: PlatformContent, account?: GHLAccount) => (
    <Card className="max-w-md mx-auto bg-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-3">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Avatar className="h-12 w-12">
              <AvatarImage src={account?.profileImage} alt={account?.name} />
              <AvatarFallback className="bg-blue-600 text-white">
                {account ? getInitials(account.name) : "LI"}
              </AvatarFallback>
            </Avatar>
            <div className="absolute -bottom-0.5 -right-0.5 bg-white rounded-full p-0.5">
              <FaLinkedin className="h-3 w-3 text-[#0A66C2]" />
            </div>
          </div>
          <div>
            <div className="font-semibold text-sm">{account?.name || "Your Name"}</div>
            <div className="text-xs text-gray-500">JUST NOW</div>
          </div>
        </div>
        <MoreHorizontal className="h-5 w-5 text-gray-500" />
      </div>

      {/* Caption */}
      {(content.caption || content.tags.length > 0) && (
        <div className="px-3 pb-3">
          <div className="text-sm whitespace-pre-wrap">{content.caption}</div>
          {content.tags.length > 0 && (
            <div className="text-sm text-blue-600 mt-1">
              {content.tags.join(' ')}
            </div>
          )}
        </div>
      )}

      {/* Media */}
      {content.videoUrl ? (
        <div className="aspect-video bg-black">
          <video src={content.videoUrl} controls className="w-full h-full object-contain" />
        </div>
      ) : content.images[0] ? (
        <div className="bg-gray-100">
          <img src={content.images[0]} alt="Post" className="w-full" />
        </div>
      ) : (
        renderEmptyMediaState()
      )}

      {/* Actions */}
      <div className="flex items-center justify-around p-3 border-t text-sm text-gray-600">
        <button className="flex items-center gap-1 hover:bg-gray-100 px-3 py-2 rounded">
          <ThumbsUp className="h-4 w-4" />
          Like
        </button>
        <button className="flex items-center gap-1 hover:bg-gray-100 px-3 py-2 rounded">
          <MessageCircle className="h-4 w-4" />
          Comment
        </button>
        <button className="flex items-center gap-1 hover:bg-gray-100 px-3 py-2 rounded">
          🔄 Repost
        </button>
        <button className="flex items-center gap-1 hover:bg-gray-100 px-3 py-2 rounded">
          <Send className="h-4 w-4" />
          Send
        </button>
      </div>
    </Card>
  );

  const renderGenericPreview = (content: PlatformContent, platformId: string, account?: GHLAccount) => {
    const platform = PLATFORMS[platformId];
    return (
      <Card className="max-w-md mx-auto bg-white overflow-hidden">
        <div className="flex items-center justify-between p-3">
          <div className="flex items-center gap-3">
            <div className="relative">
              <Avatar className="h-10 w-10">
                <AvatarImage src={account?.profileImage} alt={account?.name} />
                <AvatarFallback
                  style={{ backgroundColor: PLATFORM_COLORS[platformId] || "#6366f1" }}
                  className="text-white"
                >
                  {account ? getInitials(account.name) : platformId.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              {PLATFORM_ICONS[platformId] && (
                <div className="absolute -bottom-0.5 -right-0.5 bg-white rounded-full p-0.5">
                  {PLATFORM_ICONS[platformId]}
                </div>
              )}
            </div>
            <div>
              <div className="font-semibold text-sm">{account?.name || platform?.name || "Your Account"}</div>
              <div className="text-xs text-gray-500">JUST NOW</div>
            </div>
          </div>
          <MoreHorizontal className="h-5 w-5 text-gray-500" />
        </div>

        {(content.caption || content.tags.length > 0) && (
          <div className="px-3 pb-3">
            <div className="text-sm whitespace-pre-wrap">{content.caption}</div>
            {content.tags.length > 0 && (
              <div className="text-sm text-blue-600 mt-1">
                {content.tags.join(' ')}
              </div>
            )}
          </div>
        )}

        {content.videoUrl ? (
          <div className="aspect-video bg-black">
            <video src={content.videoUrl} controls className="w-full h-full object-contain" />
          </div>
        ) : content.images[0] ? (
          <div className="bg-gray-100">
            <img src={content.images[0]} alt="Post" className="w-full" />
          </div>
        ) : (
          renderEmptyMediaState()
        )}

        <div className="flex items-center justify-around p-3 border-t text-sm text-gray-600">
          <button className="flex items-center gap-2 hover:bg-gray-100 px-4 py-2 rounded">
            <ThumbsUp className="h-5 w-5" />
            Like
          </button>
          <button className="flex items-center gap-2 hover:bg-gray-100 px-4 py-2 rounded">
            <MessageCircle className="h-5 w-5" />
            Comment
          </button>
          <button className="flex items-center gap-2 hover:bg-gray-100 px-4 py-2 rounded">
            <Share2 className="h-5 w-5" />
            Share
          </button>
        </div>
      </Card>
    );
  };

  const renderPreview = (platformId: string, content: PlatformContent) => {
    const account = getAccountForPlatform(platformId);
    switch (platformId) {
      case 'instagram':
        return renderInstagramPreview(content, account);
      case 'facebook':
        return renderFacebookPreview(content, account);
      case 'linkedin':
        return renderLinkedInPreview(content, account);
      default:
        return renderGenericPreview(content, platformId, account);
    }
  };

  // Get unique platforms from overrides or selected platforms
  const uniquePlatformIds = selectedPlatforms.length > 0
    ? Array.from(new Set(selectedPlatforms))
    : Object.keys(platformOverrides);

  // Filter platforms based on active tab
  const platformsToRender = activeTab === "all"
    ? uniquePlatformIds
    : [activeTab].filter(p => uniquePlatformIds.includes(p));

  // Show empty state if no platforms or no content
  if (uniquePlatformIds.length === 0) {
    if (baseContent.videoUrl || baseContent.images.length > 0 || baseContent.caption) {
      return (
        <div className="h-full flex flex-col">
          <div className="p-4 border-b">
            <h3 className="font-semibold">Post Preview</h3>
          </div>
          <div className="flex-1 overflow-auto p-4">
            <div className="text-xs text-muted-foreground mb-4 text-center">
              Select a social account to preview your post here.
            </div>
            {renderGenericPreview(baseContent, 'default')}
          </div>
        </div>
      );
    }
    return (
      <div className="h-full flex flex-col">
        <div className="p-4 border-b">
          <h3 className="font-semibold">Post Preview</h3>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-8">
          <div className="w-24 h-24 rounded-full bg-muted flex items-center justify-center mb-4">
            <div className="w-16 h-16 rounded-full bg-muted-foreground/20 flex items-center justify-center">
              <div className="w-8 h-8 rounded-full bg-muted-foreground/30" />
            </div>
          </div>
          <p className="text-center">
            Select a social account to preview your post here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b">
        <h3 className="font-semibold">Post Preview</h3>
      </div>

      {/* Platform tabs */}
      <div className="flex items-center gap-1 px-4 py-2 border-b">
        <button
          onClick={() => setActiveTab("all")}
          className={cn(
            "px-3 py-1.5 text-sm font-medium rounded transition-colors",
            activeTab === "all"
              ? "text-primary border-b-2 border-primary"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          All
        </button>
        {uniquePlatformIds.map((platformId) => (
          <button
            key={platformId}
            onClick={() => setActiveTab(platformId)}
            className={cn(
              "p-2 rounded transition-colors",
              activeTab === platformId
                ? "text-primary bg-primary/10"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            )}
            style={{
              color: activeTab === platformId ? PLATFORM_COLORS[platformId] : undefined
            }}
          >
            {PLATFORM_ICONS[platformId] || platformId.slice(0, 2).toUpperCase()}
          </button>
        ))}
      </div>

      {/* Preview content */}
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {platformsToRender.map((platformId) => {
          const content = getPlatformContent(platformId);
          return (
            <div key={platformId}>
              {renderPreview(platformId, content)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
