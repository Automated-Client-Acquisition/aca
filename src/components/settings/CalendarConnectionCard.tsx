import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Loader2,
  Calendar,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Trash2,
  Plus,
} from "lucide-react";
import {
  useCalendarAccounts,
  useConnectCalendar,
  useDisconnectCalendar,
  type CalendarAccount,
} from "@/hooks/calendar/useCalendarAccounts";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

// Google Calendar icon
function GoogleCalendarIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none">
      <rect width="18" height="18" x="3" y="3" rx="2" fill="#fff" stroke="#4285F4" strokeWidth="2"/>
      <rect x="7" y="7" width="4" height="4" fill="#EA4335"/>
      <rect x="13" y="7" width="4" height="4" fill="#FBBC04"/>
      <rect x="7" y="13" width="4" height="4" fill="#34A853"/>
      <rect x="13" y="13" width="4" height="4" fill="#4285F4"/>
    </svg>
  );
}

// Microsoft/Outlook icon
function OutlookIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M7.88 12.04q0 .45-.11.87-.1.41-.33.74-.22.33-.58.52-.37.2-.87.2t-.85-.2q-.35-.21-.57-.55-.22-.33-.33-.75-.1-.42-.1-.86t.1-.87q.1-.43.34-.76.22-.34.59-.54.36-.2.87-.2t.86.2q.35.21.57.55.22.34.31.77.1.43.1.88zM24 12v9.38q0 .46-.33.8-.33.32-.8.32H7.13q-.46 0-.8-.33-.32-.33-.32-.8V18H1q-.41 0-.7-.3-.3-.29-.3-.7V7q0-.41.3-.7Q.58 6 1 6h6.5V2.55q0-.44.3-.75.3-.3.75-.3h12.9q.44 0 .75.3.3.3.3.75V5.8l-.2.04V12zm-6.85-.03V5.96c-.32-.02-.62-.1-.88-.25-.26-.14-.49-.35-.68-.62H8.25q-.31 0-.55.23-.23.23-.23.55v10.86q0 .31.23.55.24.23.55.23h3.5V12q0-.45.32-.77.32-.33.78-.33h4.3q.45 0 .77.33.33.32.33.77zM20.95 5.8V2.8H8.15v3.37q.18.06.35.09.17.03.35.03h6.7q.44 0 .77.33.33.33.33.77v2.86h4.3V5.8zm0 16.56v-9.4h-4.3q-.45 0-.77-.33-.33-.33-.33-.77v-2.86h-6.3v13.36h11.7zm-8.95-4.91h2.4l-.04-3.56-.69.03q-.19.04-.39.2-.21.17-.37.47-.17.3-.26.77-.1.46-.1 1.09 0 .69.16 1z" fill="#0072C6"/>
    </svg>
  );
}

function CalendarAccountRow({
  account,
  onDisconnect,
  isDisconnecting,
}: {
  account: CalendarAccount;
  onDisconnect: () => void;
  isDisconnecting: boolean;
}) {
  const Icon = account.provider === "google" ? GoogleCalendarIcon : OutlookIcon;
  const providerName = account.provider === "google" ? "Google Calendar" : "Outlook";

  return (
    <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
      <div className="flex items-center gap-3">
        <Icon className="h-8 w-8" />
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium">{account.email}</span>
            {account.status === "active" && (
              <CheckCircle2 className="h-4 w-4 text-green-500" />
            )}
            {account.status === "error" && (
              <AlertCircle className="h-4 w-4 text-amber-500" />
            )}
            {account.status === "disconnected" && (
              <XCircle className="h-4 w-4 text-red-500" />
            )}
          </div>
          <span className="text-sm text-muted-foreground">{providerName}</span>
        </div>
      </div>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="ghost" size="sm" disabled={isDisconnecting}>
            {isDisconnecting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4 text-destructive" />
            )}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Calendar</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to disconnect {account.email}? This will remove access to
              this calendar for scheduling meetings.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={onDisconnect}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function CalendarConnectionCard() {
  const { data: accounts, isLoading } = useCalendarAccounts();
  const connectMutation = useConnectCalendar();
  const disconnectMutation = useDisconnectCalendar();

  const hasGoogleConnected = accounts?.some((a) => a.provider === "google");
  const hasMicrosoftConnected = accounts?.some((a) => a.provider === "microsoft");
  const hasAnyConnection = accounts && accounts.length > 0;
  const allActive = accounts?.every((a) => a.status === "active");

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <CardTitle className="text-2xl flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-cta/20 to-cta/5 flex items-center justify-center">
                <Calendar className="h-5 w-5 text-cta" />
              </div>
              Calendar Integration
            </CardTitle>
            <CardDescription className="text-base">
              Connect your calendar to schedule meetings with leads directly from campaigns
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
              <Badge variant="default" className="bg-amber-600 text-white">
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
            {/* Connected accounts */}
            {accounts && accounts.length > 0 && (
              <div className="space-y-2">
                {accounts.map((account) => (
                  <CalendarAccountRow
                    key={account.id}
                    account={account}
                    onDisconnect={() => disconnectMutation.mutate(account.id)}
                    isDisconnecting={disconnectMutation.isPending}
                  />
                ))}
              </div>
            )}

            {/* Error accounts alert */}
            {accounts?.some((a) => a.status === "error" || a.status === "disconnected") && (
              <Alert variant="destructive" className="border-destructive/50">
                <XCircle className="h-4 w-4" />
                <AlertDescription className="text-sm">
                  One or more calendar connections need attention. Try reconnecting the account.
                </AlertDescription>
              </Alert>
            )}

            {/* Connect buttons */}
            <div className="flex flex-col sm:flex-row gap-2">
              {!hasGoogleConnected && (
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => connectMutation.mutate("google")}
                  disabled={connectMutation.isPending}
                >
                  {connectMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <GoogleCalendarIcon className="h-4 w-4 mr-2" />
                  )}
                  Connect Google Calendar
                </Button>
              )}
              {!hasMicrosoftConnected && (
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => connectMutation.mutate("microsoft")}
                  disabled={connectMutation.isPending}
                >
                  {connectMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <OutlookIcon className="h-4 w-4 mr-2" />
                  )}
                  Connect Outlook
                </Button>
              )}
            </div>

            {hasGoogleConnected && hasMicrosoftConnected && (
              <p className="text-sm text-muted-foreground text-center">
                All supported calendar providers are connected.
              </p>
            )}

            {!hasAnyConnection && (
              <p className="text-xs text-muted-foreground text-center">
                Connect a calendar to enable meeting scheduling from contact profiles and campaign automations.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
