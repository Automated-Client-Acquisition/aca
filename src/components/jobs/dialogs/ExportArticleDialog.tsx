import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  Download,
  Copy,
  FileCode,
  FileText,
  FileJson,
  Check,
} from "lucide-react";

interface ArticleData {
  title: string;
  text: string;
  image_url?: string;
  seo?: {
    meta_title?: string;
    meta_description?: string;
    slug?: string;
    focus_keyword?: string;
  };
  metadata?: {
    excerpt?: string;
    categories?: string[];
    tags?: string[];
    featured_image_alt?: string;
    author?: string;
  };
}

interface ExportArticleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  articleData: ArticleData;
}

type ExportFormat = "html" | "markdown" | "json";

export function ExportArticleDialog({
  open,
  onOpenChange,
  articleData,
}: ExportArticleDialogProps) {
  const [format, setFormat] = useState<ExportFormat>("html");
  const [copied, setCopied] = useState(false);

  const generateHTML = (): string => {
    const { title, text, image_url, seo, metadata } = articleData;

    // Convert markdown-like text to HTML (basic conversion)
    const contentHTML = text
      .replace(/^### (.*$)/gim, "<h3>$1</h3>")
      .replace(/^## (.*$)/gim, "<h2>$1</h2>")
      .replace(/^# (.*$)/gim, "<h1>$1</h1>")
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.*?)\*/g, "<em>$1</em>")
      .replace(/^\- (.*$)/gim, "<li>$1</li>")
      .replace(/(<li>.*<\/li>)/s, "<ul>$1</ul>")
      .replace(/\n\n/g, "</p><p>")
      .replace(/\n/g, "<br>");

    const featuredImage = image_url
      ? `<figure class="featured-image">
  <img src="${image_url}" alt="${metadata?.featured_image_alt || title}" />
</figure>`
      : "";

    const categoryList =
      metadata?.categories?.length
        ? `<div class="categories">Categories: ${metadata.categories.join(", ")}</div>`
        : "";

    const tagList =
      metadata?.tags?.length
        ? `<div class="tags">Tags: ${metadata.tags.join(", ")}</div>`
        : "";

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${seo?.meta_title || title}</title>
  <meta name="description" content="${seo?.meta_description || ""}">
  ${metadata?.author ? `<meta name="author" content="${metadata.author}">` : ""}
</head>
<body>
<article>
  <header>
    <h1>${title}</h1>
    ${metadata?.author ? `<p class="author">By ${metadata.author}</p>` : ""}
    ${metadata?.excerpt ? `<p class="excerpt">${metadata.excerpt}</p>` : ""}
  </header>

  ${featuredImage}

  <div class="content">
    <p>${contentHTML}</p>
  </div>

  <footer>
    ${categoryList}
    ${tagList}
  </footer>
</article>
</body>
</html>`;
  };

  const generateMarkdown = (): string => {
    const { title, text, image_url, seo, metadata } = articleData;

    const frontmatter = `---
title: "${title}"
${seo?.meta_title ? `seo_title: "${seo.meta_title}"` : ""}
${seo?.meta_description ? `description: "${seo.meta_description}"` : ""}
${seo?.slug ? `slug: "${seo.slug}"` : ""}
${metadata?.author ? `author: "${metadata.author}"` : ""}
${metadata?.categories?.length ? `categories:\n${metadata.categories.map((c) => `  - "${c}"`).join("\n")}` : ""}
${metadata?.tags?.length ? `tags:\n${metadata.tags.map((t) => `  - "${t}"`).join("\n")}` : ""}
${image_url ? `featured_image: "${image_url}"` : ""}
${metadata?.featured_image_alt ? `featured_image_alt: "${metadata.featured_image_alt}"` : ""}
---`;

    const featuredImage = image_url
      ? `![${metadata?.featured_image_alt || title}](${image_url})\n\n`
      : "";

    const excerpt = metadata?.excerpt
      ? `> ${metadata.excerpt}\n\n`
      : "";

    return `${frontmatter}

# ${title}

${excerpt}${featuredImage}${text}`;
  };

  const generateJSON = (): string => {
    const { title, text, image_url, seo, metadata } = articleData;

    const jsonData = {
      title,
      content: text,
      seo: {
        meta_title: seo?.meta_title || title,
        meta_description: seo?.meta_description || "",
        slug: seo?.slug || "",
        focus_keyword: seo?.focus_keyword || "",
      },
      metadata: {
        excerpt: metadata?.excerpt || "",
        categories: metadata?.categories || [],
        tags: metadata?.tags || [],
        author: metadata?.author || "",
      },
      featured_image: {
        url: image_url || null,
        alt_text: metadata?.featured_image_alt || "",
      },
      exported_at: new Date().toISOString(),
    };

    return JSON.stringify(jsonData, null, 2);
  };

  const getExportContent = (): string => {
    switch (format) {
      case "html":
        return generateHTML();
      case "markdown":
        return generateMarkdown();
      case "json":
        return generateJSON();
      default:
        return "";
    }
  };

  const getFileExtension = (): string => {
    switch (format) {
      case "html":
        return "html";
      case "markdown":
        return "md";
      case "json":
        return "json";
      default:
        return "txt";
    }
  };

  const handleCopy = async () => {
    const content = getExportContent();
    await navigator.clipboard.writeText(content);
    setCopied(true);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const content = getExportContent();
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${articleData.seo?.slug || "article"}.${getFileExtension()}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(`Downloaded as ${format.toUpperCase()}`);
  };

  const formatOptions = [
    {
      value: "html" as const,
      label: "HTML",
      description: "WordPress-ready with proper structure",
      icon: FileCode,
    },
    {
      value: "markdown" as const,
      label: "Markdown",
      description: "For static site generators (Hugo, Jekyll, etc.)",
      icon: FileText,
    },
    {
      value: "json" as const,
      label: "JSON",
      description: "Structured data for custom integrations",
      icon: FileJson,
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Export Article</DialogTitle>
          <DialogDescription>
            Choose a format to export your article for publishing
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Format Selection */}
          <RadioGroup
            value={format}
            onValueChange={(v) => setFormat(v as ExportFormat)}
            className="grid grid-cols-3 gap-4"
          >
            {formatOptions.map((option) => (
              <div key={option.value}>
                <RadioGroupItem
                  value={option.value}
                  id={option.value}
                  className="peer sr-only"
                />
                <Label
                  htmlFor={option.value}
                  className="flex flex-col items-center justify-center rounded-lg border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary cursor-pointer"
                >
                  <option.icon className="h-6 w-6 mb-2" />
                  <span className="font-medium">{option.label}</span>
                  <span className="text-xs text-muted-foreground text-center mt-1">
                    {option.description}
                  </span>
                </Label>
              </div>
            ))}
          </RadioGroup>

          {/* Preview */}
          <div className="space-y-2">
            <Label>Preview</Label>
            <Textarea
              value={getExportContent()}
              readOnly
              className="font-mono text-xs h-64"
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={handleCopy}>
              {copied ? (
                <Check className="h-4 w-4 mr-2" />
              ) : (
                <Copy className="h-4 w-4 mr-2" />
              )}
              {copied ? "Copied!" : "Copy to Clipboard"}
            </Button>
            <Button variant="cta" onClick={handleDownload}>
              <Download className="h-4 w-4 mr-2" />
              Download {format.toUpperCase()}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
