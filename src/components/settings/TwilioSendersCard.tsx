import { useMemo, useState } from "react";
import { Loader2, MessageSquareText, Plus, RefreshCw, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  useConnectTwilio,
  useDisconnectTwilio,
  useMessagingSenders,
  usePhoneBackfillJob,
  useSyncTwilio,
  useTwilioConnections,
  useUpdateMessagingSender,
  type MessagingSender,
} from "@/hooks/useMessagingSenders";

// Default country for stored numbers written without a country code
const COUNTRY_CODES = [
  "US", "GB", "FR", "CA", "AU", "IE", "DE", "ES", "IT", "NL", "BE", "CH", "PT", "LU", "AT",
  "SE", "NO", "DK", "FI", "PL", "NZ", "ZA", "AE", "IL", "IN", "SG", "HK", "BR", "MX", "MA",
];

const ADDRESS_TYPE_LABELS: Record<MessagingSender["address_type"], string> = {
  long_code: "Number",
  short_code: "Short code",
  toll_free: "Toll-free",
  alphanumeric: "Sender name",
  whatsapp: "WhatsApp",
};

function countryName(code: string | null) {
  if (!code) return "—";
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

function StatusBadge({ sender }: { sender: MessagingSender }) {
  if (sender.status === "active") return <Badge variant="secondary">Active</Badge>;
  if (sender.status === "disabled") return <Badge variant="outline">Off</Badge>;
  if (sender.status === "pending") {
    return <Badge variant="outline" title={sender.status_detail ?? undefined}>Pending</Badge>;
  }
  return <Badge variant="destructive" title={sender.status_detail ?? undefined}>Error</Badge>;
}

function CapInput({ sender }: { sender: MessagingSender }) {
  const update = useUpdateMessagingSender();
  const [value, setValue] = useState(String(sender.daily_new_contact_cap));
  const save = () => {
    const cap = Math.max(0, Math.floor(Number(value)));
    if (!Number.isFinite(cap) || cap === sender.daily_new_contact_cap) {
      setValue(String(sender.daily_new_contact_cap));
      return;
    }
    update.mutate({ id: sender.id, daily_new_contact_cap: cap });
  };
  return (
    <Input
      type="number"
      min={0}
      className="h-8 w-20"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      aria-label={`Daily new contacts for ${sender.address}`}
    />
  );
}

function ConnectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const connect = useConnectTwilio();
  const [accountSid, setAccountSid] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [defaultCountry, setDefaultCountry] = useState("US");
  const countries = useMemo(
    () => COUNTRY_CODES.map((code) => ({ code, name: countryName(code) })).sort((a, b) => a.name.localeCompare(b.name)),
    [],
  );

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    connect.mutate(
      { accountSid: accountSid.trim(), authToken: authToken.trim(), defaultCountry },
      {
        onSuccess: () => {
          setAuthToken("");
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Connect Twilio</DialogTitle>
            <DialogDescription>
              Find your Account SID and Auth Token on the Twilio Console home page. We import your SMS numbers,
              sender names and WhatsApp Business senders.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="twilio-sid">Account SID</Label>
              <Input
                id="twilio-sid"
                placeholder="AC…"
                value={accountSid}
                onChange={(e) => setAccountSid(e.target.value)}
                autoComplete="off"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="twilio-token">Auth Token</Label>
              <Input
                id="twilio-token"
                type="password"
                value={authToken}
                onChange={(e) => setAuthToken(e.target.value)}
                autoComplete="off"
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Default country for phone numbers</Label>
              <Select value={defaultCountry} onValueChange={setDefaultCountry}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {countries.map((c) => (
                    <SelectItem key={c.code} value={c.code}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Used for contacts whose number has no country code and no country on the contact or company.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="cta" disabled={connect.isPending || !accountSid || !authToken}>
              {connect.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Connect
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PhoneBackfillStatus() {
  const { data: job } = usePhoneBackfillJob();
  if (!job) return null;
  const running = job.status === "queued" || job.status === "running";
  if (job.status === "failed") {
    return (
      <p className="text-sm text-destructive">
        Preparing contact phone numbers failed: {job.error}
      </p>
    );
  }
  return (
    <p className="text-sm text-muted-foreground flex items-center gap-2">
      {running && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      {running ? "Preparing contact phone numbers… " : "Contact phone numbers ready: "}
      {job.valid.toLocaleString()} usable
      {job.invalid + job.no_country > 0 && `, ${(job.invalid + job.no_country).toLocaleString()} unusable`}
      {running && ` (${job.processed.toLocaleString()} checked)`}
    </p>
  );
}

export function TwilioSendersCard() {
  const { data: connections = [], isLoading } = useTwilioConnections();
  const { data: senders = [] } = useMessagingSenders();
  const sync = useSyncTwilio();
  const disconnect = useDisconnectTwilio();
  const update = useUpdateMessagingSender();
  const [connectOpen, setConnectOpen] = useState(false);
  const [disconnectId, setDisconnectId] = useState<string | null>(null);

  return (
    <div className="rounded-xl border bg-card p-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-[16rem] flex-1">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <MessageSquareText className="h-5 w-5 text-muted-foreground" />
            SMS &amp; WhatsApp Business
          </h3>
          <p className="text-sm text-muted-foreground">
            Your Twilio account's SMS numbers and WhatsApp Business senders. Separate from the WhatsApp accounts
            under LinkedIn &amp; social, which connect by QR code.
          </p>
        </div>
        {connections.length === 0 && (
          <Button variant="cta" className="shrink-0" onClick={() => setConnectOpen(true)} disabled={isLoading}>
            <Plus className="h-4 w-4 mr-2" />
            Connect Twilio
          </Button>
        )}
      </div>

      {connections.map((conn) => (
        <div key={conn.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3">
          <div className="text-sm">
            <span className="font-medium">{conn.account_name || "Twilio account"}</span>
            <span className="text-muted-foreground"> · {conn.account_sid}</span>
            {!conn.is_valid && (
              <Badge variant="destructive" className="ml-2">
                Credentials rejected
              </Badge>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => sync.mutate(conn.id)} disabled={sync.isPending}>
              <RefreshCw className={`h-4 w-4 mr-2 ${sync.isPending ? "animate-spin" : ""}`} />
              Sync senders
            </Button>
            <Button variant="outline" size="sm" onClick={() => setConnectOpen(true)}>
              Update credentials
            </Button>
            <Button variant="outline" size="sm" onClick={() => setDisconnectId(conn.id)}>
              <Unplug className="h-4 w-4 mr-2" />
              Disconnect
            </Button>
          </div>
        </div>
      ))}

      {connections.length > 0 && <PhoneBackfillStatus />}

      {connections.length > 0 && senders.length === 0 && (
        <Alert>
          <AlertDescription>
            No SMS numbers or WhatsApp senders found in this Twilio account. Buy a number or register a WhatsApp
            sender in the Twilio Console, then click Sync senders.
          </AlertDescription>
        </Alert>
      )}

      {senders.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Channel</TableHead>
              <TableHead>Sender</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Country</TableHead>
              <TableHead>Replies</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>New contacts / day</TableHead>
              <TableHead className="text-right">On</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {senders.map((s) => (
              <TableRow key={s.id}>
                <TableCell>
                  <Badge variant="outline">{s.channel === "sms" ? "SMS" : "WhatsApp Business"}</Badge>
                </TableCell>
                <TableCell>
                  <div className="font-medium">{s.address}</div>
                  {s.wa_display_name && <div className="text-xs text-muted-foreground">{s.wa_display_name}</div>}
                  {s.wa_quality_rating && (
                    <div className="text-xs text-muted-foreground">
                      Quality {s.wa_quality_rating.toLowerCase()}
                      {s.wa_messaging_limit && ` · ${s.wa_messaging_limit}`}
                    </div>
                  )}
                </TableCell>
                <TableCell>{ADDRESS_TYPE_LABELS[s.address_type]}</TableCell>
                <TableCell>{countryName(s.country)}</TableCell>
                <TableCell>{s.two_way ? "Yes" : "No"}</TableCell>
                <TableCell>
                  <StatusBadge sender={s} />
                </TableCell>
                <TableCell>
                  <CapInput sender={s} />
                </TableCell>
                <TableCell className="text-right">
                  <Switch
                    checked={s.status !== "disabled"}
                    disabled={s.status === "error" || s.status === "pending" || update.isPending}
                    onCheckedChange={(on) => update.mutate({ id: s.id, status: on ? "active" : "disabled" })}
                    aria-label={`Use ${s.address}`}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <ConnectDialog open={connectOpen} onOpenChange={setConnectOpen} />

      <AlertDialog open={!!disconnectId} onOpenChange={(open) => !open && setDisconnectId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Twilio?</AlertDialogTitle>
            <AlertDialogDescription>
              Its SMS and WhatsApp Business senders are removed from ACA. Nothing changes in your Twilio account.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => disconnectId && disconnect.mutate(disconnectId)}
            >
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
