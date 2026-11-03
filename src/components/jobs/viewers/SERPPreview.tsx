import { cn } from "@/lib/utils";

interface SERPPreviewProps {
  title: string;
  description: string;
  slug: string;
  domain?: string;
  className?: string;
}

export function SERPPreview({
  title,
  description,
  slug,
  domain = "yourdomain.com",
  className,
}: SERPPreviewProps) {
  // Truncate title to 60 chars as Google does
  const displayTitle = title.length > 60 ? title.slice(0, 57) + "..." : title;

  // Truncate description to 160 chars
  const displayDescription = description.length > 160
    ? description.slice(0, 157) + "..."
    : description;

  // Format slug for display
  const displayUrl = `${domain} › blog › ${slug || "article-url"}`;

  return (
    <div className={cn("space-y-2", className)}>
      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
        Google Preview
      </div>
      <div className="bg-background border rounded-lg p-4 space-y-1">
        {/* Title - Blue link style */}
        <div
          className="text-[#1a0dab] dark:text-[#8ab4f8] text-xl leading-tight cursor-pointer hover:underline truncate"
          title={title}
        >
          {displayTitle || "Article Title"}
        </div>

        {/* URL - Green/gray style */}
        <div className="text-[#006621] dark:text-[#bdc1c6] text-sm truncate">
          {displayUrl}
        </div>

        {/* Description - Gray text */}
        <div className="text-[#545454] dark:text-[#bdc1c6] text-sm leading-relaxed line-clamp-2">
          {displayDescription || "Meta description will appear here. Write a compelling summary that encourages clicks from search results."}
        </div>
      </div>
    </div>
  );
}
