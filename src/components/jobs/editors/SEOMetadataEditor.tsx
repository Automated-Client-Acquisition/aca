import { useState, useEffect, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Wand2, Check, AlertCircle, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { SERPPreview } from "../viewers/SERPPreview";

interface SEOData {
  meta_title: string;
  meta_description: string;
  slug: string;
  focus_keyword: string;
}

interface SEOMetadataEditorProps {
  seoData: SEOData;
  articleTitle: string;
  onUpdate: (updates: Partial<SEOData>) => void;
  domain?: string;
}

function generateSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "") // Remove special chars
    .replace(/\s+/g, "-") // Replace spaces with hyphens
    .replace(/-+/g, "-") // Replace multiple hyphens with single
    .replace(/^-|-$/g, "") // Remove leading/trailing hyphens
    .slice(0, 60); // Limit length
}

interface SEOCheck {
  id: string;
  label: string;
  status: "good" | "warning" | "error";
  message: string;
}

export function SEOMetadataEditor({
  seoData,
  articleTitle,
  onUpdate,
  domain = "yourdomain.com",
}: SEOMetadataEditorProps) {
  const { meta_title, meta_description, slug, focus_keyword } = seoData;

  // Character counts
  const titleLength = meta_title?.length || 0;
  const descriptionLength = meta_description?.length || 0;

  // Auto-generate slug from title if empty
  const handleGenerateSlug = () => {
    const source = meta_title || articleTitle;
    if (source) {
      onUpdate({ slug: generateSlug(source) });
    }
  };

  // SEO checks
  const seoChecks = useMemo<SEOCheck[]>(() => {
    const checks: SEOCheck[] = [];

    // Title length check
    if (titleLength === 0) {
      checks.push({
        id: "title-empty",
        label: "SEO Title",
        status: "error",
        message: "Add an SEO title",
      });
    } else if (titleLength < 30) {
      checks.push({
        id: "title-short",
        label: "SEO Title",
        status: "warning",
        message: "Title is too short (min 30 chars)",
      });
    } else if (titleLength > 60) {
      checks.push({
        id: "title-long",
        label: "SEO Title",
        status: "warning",
        message: "Title may be truncated in search results",
      });
    } else {
      checks.push({
        id: "title-ok",
        label: "SEO Title",
        status: "good",
        message: "Title length is optimal",
      });
    }

    // Description length check
    if (descriptionLength === 0) {
      checks.push({
        id: "desc-empty",
        label: "Meta Description",
        status: "error",
        message: "Add a meta description",
      });
    } else if (descriptionLength < 120) {
      checks.push({
        id: "desc-short",
        label: "Meta Description",
        status: "warning",
        message: "Description could be longer (min 120 chars)",
      });
    } else if (descriptionLength > 160) {
      checks.push({
        id: "desc-long",
        label: "Meta Description",
        status: "warning",
        message: "Description may be truncated in search results",
      });
    } else {
      checks.push({
        id: "desc-ok",
        label: "Meta Description",
        status: "good",
        message: "Description length is optimal",
      });
    }

    // Slug check
    if (!slug) {
      checks.push({
        id: "slug-empty",
        label: "URL Slug",
        status: "error",
        message: "Add a URL slug",
      });
    } else {
      checks.push({
        id: "slug-ok",
        label: "URL Slug",
        status: "good",
        message: "URL slug is set",
      });
    }

    // Focus keyword in title
    if (focus_keyword && meta_title) {
      const keywordInTitle = meta_title
        .toLowerCase()
        .includes(focus_keyword.toLowerCase());
      if (keywordInTitle) {
        checks.push({
          id: "keyword-title",
          label: "Focus Keyword",
          status: "good",
          message: "Keyword appears in title",
        });
      } else {
        checks.push({
          id: "keyword-title-missing",
          label: "Focus Keyword",
          status: "warning",
          message: "Consider adding keyword to title",
        });
      }
    }

    return checks;
  }, [meta_title, meta_description, slug, focus_keyword, titleLength, descriptionLength]);

  // Calculate overall SEO score
  const seoScore = useMemo(() => {
    const goodCount = seoChecks.filter((c) => c.status === "good").length;
    const totalChecks = seoChecks.length;
    return Math.round((goodCount / totalChecks) * 100);
  }, [seoChecks]);

  const getScoreColor = (score: number) => {
    if (score >= 80) return "text-green-600 dark:text-green-400";
    if (score >= 50) return "text-amber-600 dark:text-amber-400";
    return "text-red-600 dark:text-red-400";
  };

  const getScoreLabel = (score: number) => {
    if (score >= 80) return "Good";
    if (score >= 50) return "Needs Work";
    return "Poor";
  };

  return (
    <div className="space-y-6">
      {/* SEO Title */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="meta-title">SEO Title</Label>
          <span
            className={cn(
              "text-xs",
              titleLength > 60
                ? "text-amber-600 dark:text-amber-400"
                : "text-muted-foreground"
            )}
          >
            {titleLength}/60
          </span>
        </div>
        <Input
          id="meta-title"
          value={meta_title || ""}
          onChange={(e) => onUpdate({ meta_title: e.target.value })}
          placeholder="Enter SEO-optimized title (50-60 characters)"
          className={cn(titleLength > 60 && "border-amber-500")}
        />
        {titleLength === 0 && articleTitle && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onUpdate({ meta_title: articleTitle.slice(0, 60) })}
            className="h-7 text-xs"
          >
            <Wand2 className="h-3 w-3 mr-1" />
            Use article title
          </Button>
        )}
      </div>

      {/* Meta Description */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="meta-description">Meta Description</Label>
          <span
            className={cn(
              "text-xs",
              descriptionLength > 160
                ? "text-amber-600 dark:text-amber-400"
                : "text-muted-foreground"
            )}
          >
            {descriptionLength}/160
          </span>
        </div>
        <Textarea
          id="meta-description"
          value={meta_description || ""}
          onChange={(e) => onUpdate({ meta_description: e.target.value })}
          placeholder="Write a compelling description for search results (120-160 characters)"
          rows={3}
          className={cn(descriptionLength > 160 && "border-amber-500")}
        />
      </div>

      {/* URL Slug */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="slug">URL Slug</Label>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleGenerateSlug}
            className="h-7 text-xs"
          >
            <Wand2 className="h-3 w-3 mr-1" />
            Auto-generate
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground whitespace-nowrap">
            {domain}/blog/
          </span>
          <Input
            id="slug"
            value={slug || ""}
            onChange={(e) =>
              onUpdate({ slug: generateSlug(e.target.value) })
            }
            placeholder="article-url-slug"
            className="flex-1"
          />
        </div>
      </div>

      {/* Focus Keyword */}
      <div className="space-y-2">
        <Label htmlFor="focus-keyword">Focus Keyword (Optional)</Label>
        <Input
          id="focus-keyword"
          value={focus_keyword || ""}
          onChange={(e) => onUpdate({ focus_keyword: e.target.value })}
          placeholder="Primary keyword to optimize for"
        />
        <p className="text-xs text-muted-foreground">
          The main keyword you want this article to rank for
        </p>
      </div>

      {/* SERP Preview */}
      <SERPPreview
        title={meta_title || articleTitle || ""}
        description={meta_description || ""}
        slug={slug || ""}
        domain={domain}
      />

      {/* SEO Score */}
      <div className="bg-muted/30 rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">SEO Score</span>
          <span className={cn("text-sm font-semibold", getScoreColor(seoScore))}>
            {seoScore}% {getScoreLabel(seoScore)}
          </span>
        </div>

        {/* Progress bar */}
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div
            className={cn(
              "h-full transition-all duration-300",
              seoScore >= 80
                ? "bg-green-500"
                : seoScore >= 50
                ? "bg-amber-500"
                : "bg-red-500"
            )}
            style={{ width: `${seoScore}%` }}
          />
        </div>

        {/* Checks list */}
        <div className="space-y-1.5 pt-2">
          {seoChecks.map((check) => (
            <div key={check.id} className="flex items-center gap-2 text-sm">
              {check.status === "good" ? (
                <Check className="h-4 w-4 text-green-500 flex-shrink-0" />
              ) : check.status === "warning" ? (
                <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0" />
              ) : (
                <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0" />
              )}
              <span
                className={cn(
                  check.status === "good"
                    ? "text-muted-foreground"
                    : check.status === "warning"
                    ? "text-amber-700 dark:text-amber-300"
                    : "text-red-700 dark:text-red-300"
                )}
              >
                {check.message}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
