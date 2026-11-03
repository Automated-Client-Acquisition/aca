import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, MessageSquare, CheckCircle2, XCircle, AlertCircle, ArrowRight } from "lucide-react";
import { useUnipileAccounts } from "@/hooks/useUnipileAccounts";
import { Link } from "react-router-dom";

export function UnipileConnectionCard() {
  const { data, isLoading } = useUnipileAccounts();

  const totalConnected = data?.accounts?.length || 0;
  const hasAnyConnection = totalConnected > 0;
  const allActive = data?.accounts.every(a => a.status === 'active');

  // Build provider summary from actual connected accounts
  const providerCounts = (data?.accounts || []).reduce<Record<string, number>>((acc, a) => {
    const p = a.provider;
    acc[p] = (acc[p] || 0) + 1;
    return acc;
  }, {});

  const PROVIDER_LABELS: Record<string, string> = {
    LINKEDIN: 'LinkedIn',
    INSTAGRAM: 'Instagram',
    WHATSAPP: 'WhatsApp',
    TELEGRAM: 'Telegram',
    MESSENGER: 'Messenger',
    TWITTER: 'X',
    GOOGLE: 'Gmail',
    OUTLOOK: 'Outlook',
    MAIL: 'Email',
    EMAIL: 'Email',
  };

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <CardTitle className="text-2xl flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
                <MessageSquare className="h-5 w-5 text-primary" />
              </div>
              Unipile Integration
            </CardTitle>
            <CardDescription className="text-base">
              Multi-channel accounts for outreach campaigns and lead magnet delivery
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {hasAnyConnection && allActive && (
              <Badge variant="default" className="bg-green-600 text-white">
                <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                Connected
              </Badge>
            )}
            {hasAnyConnection && !allActive && (
              <Badge variant="default" className="bg-status-warning text-status-warning-foreground">
                <AlertCircle className="h-3.5 w-3.5 mr-1.5" />
                Needs Attention
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {/* Status summary */}
            <div className="p-4 rounded-lg border bg-muted/30 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 flex-wrap">
                  {Object.entries(providerCounts).map(([provider, count]) => (
                    <span key={provider} className="text-sm font-medium">
                      {count} {PROVIDER_LABELS[provider] || provider}
                    </span>
                  ))}
                  {totalConnected === 0 && (
                    <span className="text-sm text-muted-foreground">No accounts connected yet</span>
                  )}
                </div>
                {totalConnected > 0 && (
                  <span className="text-sm text-muted-foreground">
                    {totalConnected} account{totalConnected !== 1 ? 's' : ''} connected
                  </span>
                )}
              </div>

              {data?.accounts.some(a => a.status === 'expired' || a.status === 'error') && (
                <Alert variant="destructive" className="border-destructive/50">
                  <XCircle className="h-4 w-4" />
                  <AlertDescription className="text-sm">
                    One or more accounts need attention.
                  </AlertDescription>
                </Alert>
              )}
            </div>

            {/* Link to Settings > Sending > LinkedIn & social */}
            <Button asChild className="w-full" variant="outline">
              <Link to="/settings?tab=senders">
                Manage accounts
                <ArrowRight className="h-4 w-4 ml-2" />
              </Link>
            </Button>

            <p className="text-xs text-muted-foreground text-center">
              Connect and manage accounts across all channels. Configure rate limits and schedules in Settings → LinkedIn &amp; social.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
