import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { sitemapRoutes } from "@/sitemap-routes";
import { RefreshCw, CheckCircle, XCircle, Globe } from "lucide-react";
import { PUBLIC_SITE_URL } from "@/config/site";

const BASE_URL = PUBLIC_SITE_URL;

export function GoogleIndexingSettings() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    submitted: number;
    failed: number;
    errors?: { url: string; error?: string }[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const urls = sitemapRoutes.map((route) => `${BASE_URL}${route.path}`);

  async function handleSubmit() {
    setLoading(true);
    setResult(null);
    setError(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke(
        "notify-google-indexing",
        { body: { urls, type: "URL_UPDATED" } }
      );

      if (fnError) throw fnError;
      if (!data.success) throw new Error(data.error ?? "Unknown error");

      setResult({ submitted: data.submitted, failed: data.failed, errors: data.errors });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-medium">Google Search Indexing</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Submit all site URLs to the Google Indexing API after deploying new pages or blog posts.
          Sends {urls.length} URLs in batches of 200.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Button variant="cta" onClick={handleSubmit} disabled={loading}>
          {loading ? (
            <>
              <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
              Submitting...
            </>
          ) : (
            <>
              <Globe className="w-4 h-4 mr-2" />
              Submit all URLs to Google
            </>
          )}
        </Button>

        {result && (
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle className="w-4 h-4 text-green-500" />
            <span className="text-green-600">{result.submitted} submitted</span>
            {result.failed > 0 && (
              <>
                <XCircle className="w-4 h-4 text-destructive" />
                <span className="text-destructive">{result.failed} failed</span>
              </>
            )}
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <XCircle className="w-4 h-4" />
            <span>{error}</span>
          </div>
        )}
      </div>

      {result?.errors && result.errors.length > 0 && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 space-y-1">
          <p className="text-xs font-medium text-destructive">Failed URLs:</p>
          {result.errors.map((e) => (
            <div key={e.url} className="text-xs text-muted-foreground flex items-start gap-2">
              <Badge variant="destructive" className="shrink-0 text-xs">failed</Badge>
              <span className="break-all">{e.url} - {e.error}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
