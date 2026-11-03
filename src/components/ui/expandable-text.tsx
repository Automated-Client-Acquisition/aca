import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronUp } from "lucide-react";

interface ExpandableTextProps {
  text: string | null | undefined;
  maxLines?: number;
  className?: string;
  expandedClassName?: string;
}

export function ExpandableText({
  text,
  maxLines = 2,
  className,
  expandedClassName
}: ExpandableTextProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isTruncated, setIsTruncated] = useState(false);
  const textRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const element = textRef.current;
    if (element) {
      // Check if text is actually truncated
      setIsTruncated(element.scrollHeight > element.clientHeight);
    }
  }, [text, maxLines]);

  if (!text) {
    return <span className="text-muted-foreground">—</span>;
  }

  const handleClick = (e: React.MouseEvent) => {
    if (isTruncated || isExpanded) {
      e.stopPropagation();
      setIsExpanded(!isExpanded);
    }
  };

  return (
    <div
      className={cn(
        "relative cursor-pointer group/expand",
        (isTruncated || isExpanded) && "hover:bg-muted/50 rounded-md -m-1 p-1 transition-colors"
      )}
      onClick={handleClick}
    >
      <span
        ref={textRef}
        className={cn(
          "text-sm text-muted-foreground transition-colors duration-200",
          !isExpanded && `line-clamp-${maxLines}`,
          isExpanded && expandedClassName,
          className
        )}
        style={!isExpanded ? {
          display: '-webkit-box',
          WebkitLineClamp: maxLines,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden'
        } : undefined}
      >
        {text}
      </span>
      {(isTruncated || isExpanded) && (
        <span className="inline-flex items-center gap-0.5 text-xs text-primary ml-1 opacity-0 group-hover/expand:opacity-100 transition-opacity">
          {isExpanded ? (
            <>
              <ChevronUp className="w-3 h-3" />
              <span>less</span>
            </>
          ) : (
            <>
              <ChevronDown className="w-3 h-3" />
              <span>more</span>
            </>
          )}
        </span>
      )}
    </div>
  );
}
