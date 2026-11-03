import { useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { AlertCircle, AlertTriangle, CheckCircle2, ClipboardList, Info, Loader2, Plus, Users, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useAddPostShibaSenders,
  getPostShibaProvisionError,
  POSTSHIBA_LOCAL_PART_RE,
  POSTSHIBA_MAX_SENDERS_PER_CALL,
  type AddPostShibaSendersResult,
  type PostShibaDomain,
  type PostShibaProvisionErrorCode,
  type PostShibaSender,
} from "@/hooks/usePostShibaDomains";
import { getDomainStage, initials } from "./postshiba-shared";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  domain: PostShibaDomain;
  existingSenders: PostShibaSender[];
}

type AddressFormat = "first" | "first.last" | "firstlast" | "flast";

const FORMATS: Array<{ value: AddressFormat; example: string }> = [
  { value: "first", example: "jane" },
  { value: "first.last", example: "jane.doe" },
  { value: "firstlast", example: "janedoe" },
  { value: "flast", example: "jdoe" },
];

const VOLUME_PRESETS = [100, 250, 500];
const ACTIVE_STATUSES = new Set(["ready", "active", "warming"]);

interface SenderRow {
  key: number;
  first: string;
  last: string;
  local: string;
  /** Once the user types an address, stop rewriting it from the name. */
  localEdited: boolean;
}

interface InlineError {
  message: string;
  code?: PostShibaProvisionErrorCode;
  skipped?: string[];
}

const ERROR_TITLES: Partial<Record<PostShibaProvisionErrorCode, string>> = {
  invalid_daily_limit: "Daily limit not valid",
  invalid_daily_volume: "Daily volume not valid",
  invalid_senders: "Check the senders",
  senders_in_use: "Addresses already in use",
  not_connected: "Not connected",
  connection_inactive: "Connection inactive",
  connection_mismatch: "Domain is on another connection",
  rate_limited: "Too many requests",
  not_found: "Domain not found",
  feature_disabled: "PostShiba is not enabled",
};

/** "José" -> "jose": lowercase, accents dropped, only characters an address allows. */
function slug(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function suggestLocalPart(first: string, last: string, format: AddressFormat): string {
  const f = slug(first);
  const l = slug(last);
  if (!f) return "";
  switch (format) {
    case "first.last":
      return l ? `${f}.${l}` : f;
    case "firstlast":
      return `${f}${l}`;
    case "flast":
      return l ? `${f[0]}${l}` : f;
    default:
      return f;
  }
}

function isValidLocalPart(local: string): boolean {
  return POSTSHIBA_LOCAL_PART_RE.test(local) && !local.includes("..");
}

function isBlank(row: SenderRow): boolean {
  return !row.first.trim() && !row.last.trim() && !row.local.trim();
}

/** Lines of "First Last" or "First Last, address". Everything after the first word is the last name. */
function parsePastedSenders(text: string): { rows: Array<Pick<SenderRow, "first" | "last" | "local" | "localEdited">>; badLines: number } {
  const rows: Array<Pick<SenderRow, "first" | "last" | "local" | "localEdited">> = [];
  let badLines = 0;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const comma = line.indexOf(",");
    const namePart = comma >= 0 ? line.slice(0, comma) : line;
    const localPart = comma >= 0 ? line.slice(comma + 1).trim().toLowerCase().replace(/@.*$/, "") : "";
    const words = namePart.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      badLines += 1;
      continue;
    }
    rows.push({ first: words[0], last: words.slice(1).join(" "), local: localPart, localEdited: !!localPart });
  }
  return { rows, badLines };
}

export function AddPostShibaSendersDialog({ open, onOpenChange, domain, existingSenders }: Props) {
  const nextKey = useRef(1);
  const newRow = (values?: Partial<Omit<SenderRow, "key">>): SenderRow => ({
    key: nextKey.current++,
    first: "",
    last: "",
    local: "",
    localEdited: false,
    ...values,
  });

  const [format, setFormat] = useState<AddressFormat>("first");
  const [rows, setRows] = useState<SenderRow[]>(() => [newRow()]);
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [dailyVolume, setDailyVolume] = useState(domain.daily_volume ? String(domain.daily_volume) : "");
  const [error, setError] = useState<InlineError | null>(null);
  const [result, setResult] = useState<AddPostShibaSendersResult | null>(null);

  const addSenders = useAddPostShibaSenders();
  const busy = addSenders.isPending;

  const existingEmails = useMemo(
    () => new Set(existingSenders.map((s) => s.email_address.toLowerCase())),
    [existingSenders],
  );

  // A row's address is the typed one, or the one the chosen format suggests.
  const localFor = (r: SenderRow) => (r.localEdited ? r.local.trim().toLowerCase() : suggestLocalPart(r.first, r.last, format));
  const filledRows = rows.filter((r) => !isBlank(r));

  const rowErrors = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of filledRows) counts.set(localFor(r), (counts.get(localFor(r)) ?? 0) + 1);
    const errors = new Map<number, string>();
    for (const r of filledRows) {
      const local = localFor(r);
      if (!r.first.trim()) errors.set(r.key, "Add a first name.");
      else if (!local) errors.set(r.key, "Add the part before the @.");
      else if (!isValidLocalPart(local))
        errors.set(r.key, "Use letters, numbers, dots, dashes or underscores, starting and ending with a letter or number.");
      else if ((counts.get(local) ?? 0) > 1) errors.set(r.key, "This address is listed twice.");
    }
    return errors;
    // localFor depends on format, which is in the deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, format]);

  // Auto domains are sized to the cluster by the database: no volume to type.
  const autoVolume = domain.volume_mode === "auto";
  const volumeValue = /^\d+$/.test(dailyVolume.trim()) ? parseInt(dailyVolume.trim(), 10) : NaN;
  // The upper bound is the cluster's daily limit, which the server checks.
  const volumeValid = autoVolume || (Number.isInteger(volumeValue) && volumeValue >= 1);
  const tooMany = filledRows.length > POSTSHIBA_MAX_SENDERS_PER_CALL;
  const canSubmit = filledRows.length > 0 && rowErrors.size === 0 && volumeValid && !tooMany && !busy;
  const updates = filledRows.filter((r) => existingEmails.has(`${localFor(r)}@${domain.domain}`)).length;
  // The volume is split across every active sender on the domain, new and existing.
  const sendersAfter = existingSenders.filter((s) => ACTIVE_STATUSES.has(s.status)).length + filledRows.length - updates;
  const share = !autoVolume && volumeValid && sendersAfter > 0 ? Math.floor(volumeValue / sendersAfter) : null;

  const reset = () => {
    nextKey.current = 1;
    setFormat("first");
    setRows([newRow()]);
    setShowPaste(false);
    setPasteText("");
    setDailyVolume(domain.daily_volume ? String(domain.daily_volume) : "");
    setError(null);
    setResult(null);
    addSenders.reset();
  };

  const handleClose = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const updateRow = (key: number, patch: Partial<Omit<SenderRow, "key">>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const removeRow = (key: number) => setRows((prev) => (prev.length <= 1 ? [newRow()] : prev.filter((r) => r.key !== key)));

  const parsed = useMemo(() => parsePastedSenders(pasteText), [pasteText]);

  const applyPaste = () => {
    if (parsed.rows.length === 0) return;
    setRows((prev) => [...prev.filter((r) => !isBlank(r)), ...parsed.rows.map((r) => newRow(r))]);
    setPasteText("");
    setShowPaste(false);
  };

  const submit = async () => {
    if (!canSubmit) return;
    setError(null);
    try {
      const res = await addSenders.mutateAsync({
        domain_id: domain.id,
        ...(autoVolume ? {} : { daily_volume: volumeValue }),
        senders: filledRows.map((r) => ({ first_name: r.first.trim(), last_name: r.last.trim(), local_part: localFor(r) })),
      });
      setResult(res);
    } catch (err) {
      setError(getPostShibaProvisionError(err));
    }
  };

  const ready = getDomainStage(domain) === "ready";

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && handleClose(next)}>
      <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col gap-0 p-0">
        <DialogHeader className="border-b px-6 pb-4 pt-6">
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            {result ? "Senders added" : "Add senders"}
          </DialogTitle>
          <DialogDescription>
            {result ? (
              <>On <span className="font-medium text-foreground">{domain.domain}</span></>
            ) : (
              <>
                Each sender sends from their own address on{" "}
                <span className="font-medium text-foreground">{domain.domain}</span>.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <SuccessView result={result} domainReady={ready} onDone={() => handleClose(false)} />
        ) : (
          <form
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label className="text-sm">Address format</Label>
                  <ToggleGroup
                    type="single"
                    value={format}
                    onValueChange={(v) => v && setFormat(v as AddressFormat)}
                    className="rounded-lg border p-0.5"
                    disabled={busy}
                  >
                    {FORMATS.map((f) => (
                      <ToggleGroupItem
                        key={f.value}
                        value={f.value}
                        className="h-7 rounded-md px-2.5 font-mono text-xs data-[state=on]:bg-foreground data-[state=on]:text-background"
                        aria-label={`Addresses like ${f.example}@${domain.domain}`}
                      >
                        {f.example}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <Label className="text-sm">Senders</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setShowPaste((v) => !v)}
                    disabled={busy}
                  >
                    <ClipboardList className="h-3.5 w-3.5" />
                    {showPaste ? "Close paste" : "Paste a list"}
                  </Button>
                </div>

                {showPaste && (
                  <div className="space-y-2 rounded-xl border bg-muted/20 p-3">
                    <Textarea
                      value={pasteText}
                      onChange={(e) => setPasteText(e.target.value)}
                      placeholder={"Jane Doe\nSam Lee, sam.lee"}
                      rows={5}
                      className="font-mono text-xs"
                      aria-label="Paste senders, one per line"
                      autoFocus
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs text-muted-foreground">
                        One per line: <code className="font-mono">First Last</code>, optionally{" "}
                        <code className="font-mono">, address</code>.
                        {parsed.badLines > 0 && ` ${parsed.badLines} line${parsed.badLines === 1 ? "" : "s"} skipped.`}
                      </p>
                      <Button type="button" variant="cta" size="sm" onClick={applyPaste} disabled={parsed.rows.length === 0}>
                        Add {parsed.rows.length || ""} sender{parsed.rows.length === 1 ? "" : "s"}
                      </Button>
                    </div>
                  </div>
                )}

                <div className="overflow-hidden rounded-xl border">
                  <div className="hidden grid-cols-[1fr_1fr_1.8fr_2rem] gap-2 border-b bg-muted/30 px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground sm:grid">
                    <span>First name</span>
                    <span>Last name</span>
                    <span>Address</span>
                    <span />
                  </div>
                  <div className="max-h-[36vh] divide-y overflow-y-auto">
                    {rows.map((row, index) => {
                      const rowError = rowErrors.get(row.key);
                      const local = localFor(row);
                      const isUpdate = local && existingEmails.has(`${local}@${domain.domain}`);
                      return (
                        <div key={row.key} className="space-y-1.5 px-3 py-2.5">
                          <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[1fr_1fr_1.8fr_2rem]">
                            <Input
                              value={row.first}
                              onChange={(e) => updateRow(row.key, { first: e.target.value })}
                              placeholder="Jane"
                              aria-label={`First name, sender ${index + 1}`}
                              disabled={busy}
                              autoFocus={index === 0 && rows.length === 1}
                              className="h-9"
                            />
                            <Input
                              value={row.last}
                              onChange={(e) => updateRow(row.key, { last: e.target.value })}
                              placeholder="Doe"
                              aria-label={`Last name, sender ${index + 1}`}
                              disabled={busy}
                              className="h-9"
                            />
                            <div
                              className={cn(
                                "flex h-9 min-w-0 items-center rounded-md border bg-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1",
                                rowError && "border-destructive",
                              )}
                            >
                              <input
                                value={row.localEdited ? row.local : local}
                                onChange={(e) => updateRow(row.key, { local: e.target.value.toLowerCase(), localEdited: true })}
                                placeholder={FORMATS.find((f) => f.value === format)?.example}
                                aria-label={`Address before the @, sender ${index + 1}`}
                                disabled={busy}
                                autoComplete="off"
                                spellCheck={false}
                                className="h-full min-w-0 flex-1 bg-transparent pl-3 font-mono text-xs outline-none placeholder:text-muted-foreground"
                              />
                              <span
                                className="max-w-[65%] flex-shrink truncate pr-3 font-mono text-xs text-muted-foreground"
                                title={`@${domain.domain}`}
                              >
                                @{domain.domain}
                              </span>
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 justify-self-end text-muted-foreground"
                              onClick={() => removeRow(row.key)}
                              disabled={busy}
                              aria-label={`Remove sender ${index + 1}`}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                          {rowError ? (
                            <p className="text-xs text-destructive">{rowError}</p>
                          ) : isUpdate ? (
                            <p className="text-xs text-muted-foreground">Already a sender here. Saving updates their name and daily limit.</p>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                  <div className="border-t bg-muted/20 px-3 py-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => setRows((prev) => [...prev, newRow()])}
                      disabled={busy || rows.length >= POSTSHIBA_MAX_SENDERS_PER_CALL}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add another
                    </Button>
                  </div>
                </div>
                {tooMany && (
                  <p className="text-xs text-destructive">
                    Up to {POSTSHIBA_MAX_SENDERS_PER_CALL} senders at a time. Remove{" "}
                    {filledRows.length - POSTSHIBA_MAX_SENDERS_PER_CALL} to continue.
                  </p>
                )}
              </div>

              {autoVolume ? (
                <div className="space-y-1 rounded-lg border bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
                  <p className="text-sm font-medium text-foreground">Daily volume: auto</p>
                  <p>
                    Sized to your cluster's daily limit, up to{" "}
                    <span className="font-medium text-foreground">{domain.sender_cap.toLocaleString()} a sender a day</span>
                    {sendersAfter > 0 && <> ({(domain.sender_cap * sendersAfter).toLocaleString()} a day from {sendersAfter} sender{sendersAfter === 1 ? "" : "s"})</>}.
                    Change it from the domain's daily volume.
                  </p>
                </div>
              ) : (
              <div className="space-y-2.5">
                <Label htmlFor="postshiba-daily-volume" className="text-sm">
                  Emails a day from {domain.domain}
                </Label>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    id="postshiba-daily-volume"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    step={1}
                    value={dailyVolume}
                    onChange={(e) => setDailyVolume(e.target.value)}
                    placeholder="e.g. 250"
                    disabled={busy}
                    className={cn("h-9 w-32", dailyVolume.trim() && !volumeValid && "border-destructive")}
                  />
                  {VOLUME_PRESETS.map((n) => (
                    <Button
                      key={n}
                      type="button"
                      size="sm"
                      variant="outline"
                      className={cn("h-9 px-3 tabular-nums", volumeValue === n && "border-foreground/60 bg-muted")}
                      onClick={() => setDailyVolume(String(n))}
                      disabled={busy}
                    >
                      {n}
                    </Button>
                  ))}
                </div>
                {dailyVolume.trim() && !volumeValid ? (
                  <p className="text-xs text-destructive">Enter a whole number of at least 1.</p>
                ) : (
                  <div className="space-y-1 text-xs text-muted-foreground">
                    {share !== null && (
                      <p>
                        Split evenly across {sendersAfter} sender{sendersAfter === 1 ? "" : "s"}:{" "}
                        <span className="font-medium text-foreground">
                          {share === 0 ? "less than 1" : `about ${share.toLocaleString()}`}
                        </span>{" "}
                        each.
                        {volumeValid && volumeValue < sendersAfter && " Some senders won't send until you raise it."}
                      </p>
                    )}
                    <p>
                      This is the domain's total, shared by all its senders. New domains do best starting
                      around 100 a day and growing over a few weeks.
                    </p>
                  </div>
                )}
              </div>
              )}

              {error && (
                <div role="alert" className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5">
                  <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-destructive" />
                  <div className="min-w-0 text-sm">
                    {error.code && ERROR_TITLES[error.code] && (
                      <div className="font-semibold text-destructive">{ERROR_TITLES[error.code]}</div>
                    )}
                    <div className="text-foreground/80">{error.message}</div>
                    {error.skipped && error.skipped.length > 0 && (
                      <ul className="mt-1.5 space-y-0.5 font-mono text-xs">
                        {error.skipped.map((a) => (
                          <li key={a} className="break-all">{a}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}
            </div>

            <DialogFooter className="items-center gap-3 border-t bg-muted/20 px-6 py-4 sm:justify-between sm:space-x-0">
              <div className="text-xs text-muted-foreground">
                {filledRows.length > 0 ? (
                  <>
                    <span className="font-medium text-foreground">
                      {filledRows.length} sender{filledRows.length === 1 ? "" : "s"}
                    </span>
                    {updates > 0 && <> ({updates} updated)</>}
                    {autoVolume
                      ? <> · up to {domain.sender_cap.toLocaleString()} a sender a day</>
                      : volumeValid && <> · {volumeValue.toLocaleString()} a day from the domain</>}
                  </>
                ) : (
                  "No senders yet"
                )}
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => handleClose(false)} disabled={busy}>
                  Cancel
                </Button>
                <Button type="submit" variant="cta" disabled={!canSubmit}>
                  {busy ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Adding...
                    </>
                  ) : filledRows.length > 1 ? (
                    `Add ${filledRows.length} senders`
                  ) : (
                    "Add sender"
                  )}
                </Button>
              </div>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SuccessView({
  result,
  domainReady,
  onDone,
}: {
  result: AddPostShibaSendersResult;
  domainReady: boolean;
  onDone: () => void;
}) {
  return (
    <>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
        <div className="flex items-center gap-3 rounded-xl border border-green-500/30 bg-green-500/[0.06] p-4">
          <CheckCircle2 className="h-5 w-5 flex-shrink-0 text-green-600 dark:text-green-500" />
          <div className="text-sm">
            <span className="font-semibold">
              {result.senders.length} sender{result.senders.length === 1 ? "" : "s"} saved
            </span>
          </div>
        </div>

        <div className="divide-y overflow-hidden rounded-xl border">
          {result.senders.map((s) => (
            <div key={s.id} className="flex items-center gap-3 px-3 py-2">
              <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-cta/30 text-[10px] font-semibold">
                {initials(s.display_name || s.email_address)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">{s.display_name || s.email_address}</div>
                <div className="truncate font-mono text-xs text-muted-foreground">{s.email_address}</div>
              </div>
              <span className="flex-shrink-0 text-xs tabular-nums text-muted-foreground">
                <span className="font-medium text-foreground">{s.daily_limit}</span> a day
              </span>
            </div>
          ))}
        </div>

        {result.capped && (
          <p className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle className="mt-px h-3.5 w-3.5 flex-shrink-0" />
            A per-mailbox limit lowered the daily limit you entered.
          </p>
        )}

        {result.skipped.length > 0 && (
          <div className="rounded-xl border border-dashed p-3 text-sm">
            <div className="mb-1.5 text-muted-foreground">
              Skipped {result.skipped.length === 1 ? "an address" : `${result.skipped.length} addresses`} already used by
              other mailboxes in ACA:
            </div>
            <ul className="space-y-0.5 font-mono text-xs">
              {result.skipped.map((a) => (
                <li key={a} className="break-all">{a}</li>
              ))}
            </ul>
          </div>
        )}

        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Info className="mt-px h-3.5 w-3.5 flex-shrink-0" />
          {domainReady
            ? "They can send now. Add them to a sequence to start."
            : "They can send once the domain is ready, so replies and bounces reach ACA."}
        </p>
      </div>
      <DialogFooter className="border-t bg-muted/20 px-6 py-4">
        <Button variant="cta" onClick={onDone}>
          Done
        </Button>
      </DialogFooter>
    </>
  );
}
