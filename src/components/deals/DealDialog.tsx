import { useEffect, useMemo, useState } from "react";
import { format, formatDistanceToNowStrict } from "date-fns";
import { Link } from "react-router-dom";
import { Loader2, Trash2, Trophy, XCircle, RotateCcw, ExternalLink } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useOrganizationMembers } from "@/hooks/useOrganizationMembers";
import { useAuth } from "@/contexts/AuthContext";
import {
  type CrmDeal,
  type DealInput,
  type DealPipeline,
  formatMoney,
  useCreateDeal,
  useUpdateDeal,
  useDeleteDeal,
  useDealHistory,
} from "@/hooks/crm/useDeals";
import type { CrmPipelineStage } from "@/hooks/crm/useContacts";
import { ContactPicker, CompanyPicker, type PickedContact, type PickedCompany } from "./DealLinkPickers";
import { LostReasonDialog } from "./LostReasonDialog";
import { cn } from "@/lib/utils";

const DEAL_CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "CHF"];
const UNASSIGNED = "__unassigned__";

interface DealDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipelines: DealPipeline[];
  /** Edit this deal; omit to create. */
  deal?: CrmDeal | null;
  defaultPipelineId?: string;
  defaultStageId?: string;
  defaultContact?: PickedContact | null;
  defaultCompany?: PickedCompany | null;
}

const isOpenStage = (s: CrmPipelineStage) => s.stage_type !== "won" && s.stage_type !== "lost";

/** Deal record panel (create + edit), slides in from the right like Close/Attio. */
export function DealDialog({
  open,
  onOpenChange,
  pipelines,
  deal,
  defaultPipelineId,
  defaultStageId,
  defaultContact,
  defaultCompany,
}: DealDialogProps) {
  const isEdit = !!deal;
  const { user } = useAuth();
  const { data: members = [] } = useOrganizationMembers();
  const createDeal = useCreateDeal();
  const updateDeal = useUpdateDeal();
  const deleteDeal = useDeleteDeal();
  const { data: history = [] } = useDealHistory(open && deal ? deal.id : null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [askLostReason, setAskLostReason] = useState(false);

  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [pipelineId, setPipelineId] = useState("");
  const [stageId, setStageId] = useState("");
  const [confidence, setConfidence] = useState("");
  const [closeDate, setCloseDate] = useState("");
  const [ownerId, setOwnerId] = useState<string>(UNASSIGNED);
  const [contact, setContact] = useState<PickedContact | null>(null);
  const [company, setCompany] = useState<PickedCompany | null>(null);
  const [description, setDescription] = useState("");
  const [lostReason, setLostReason] = useState("");

  // Reset the form each time the panel opens.
  useEffect(() => {
    if (!open) return;
    const pipeline = pipelines.find((p) => p.id === (deal?.pipeline_id ?? defaultPipelineId)) ?? pipelines[0];
    setName(deal?.name ?? "");
    setValue(deal ? String(deal.value) : "");
    setCurrency(deal?.currency ?? "USD");
    setPipelineId(pipeline?.id ?? "");
    setStageId(deal?.stage_id ?? defaultStageId ?? pipeline?.stages.find(isOpenStage)?.id ?? "");
    setConfidence(deal?.confidence != null ? String(deal.confidence) : "");
    setCloseDate(deal?.expected_close_date ?? "");
    setOwnerId(deal ? deal.owner_user_id ?? UNASSIGNED : user?.id ?? UNASSIGNED);
    setContact(deal?.contact ? { id: deal.contact.id, display_name: deal.contact.display_name } : defaultContact ?? null);
    setCompany(deal?.company ? { id: deal.company.id, name: deal.company.name } : defaultCompany ?? null);
    setDescription(deal?.description ?? "");
    setLostReason(deal?.lost_reason ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, deal?.id]);

  const pipeline = pipelines.find((p) => p.id === pipelineId);
  const stage = pipeline?.stages.find((s) => s.id === stageId);
  const openStages = pipeline?.stages.filter(isOpenStage) ?? [];
  const wonStage = pipeline?.stages.find((s) => s.stage_type === "won");
  const lostStage = pipeline?.stages.find((s) => s.stage_type === "lost");
  const stageIndex = openStages.findIndex((s) => s.id === stageId);
  const closedAs = stage?.stage_type === "won" ? "won" : stage?.stage_type === "lost" ? "lost" : null;
  const stageById = useMemo(
    () => Object.fromEntries(pipelines.flatMap((p) => p.stages).map((s) => [s.id, s])),
    [pipelines],
  );

  const handlePipelineChange = (id: string) => {
    setPipelineId(id);
    const next = pipelines.find((p) => p.id === id);
    setStageId(next?.stages.find(isOpenStage)?.id ?? "");
  };

  // Picking a contact fills an empty company from the contact's account, and a
  // blank deal name from the account.
  const handleContactChange = (c: PickedContact | null) => {
    setContact(c);
    if (c && !company && c.company_id) setCompany({ id: c.company_id, name: c.company || "Linked company" });
    if (c && !name.trim()) setName(c.company ? `${c.company} deal` : `${c.display_name} deal`);
  };

  const parsedConfidence = confidence.trim() === "" ? null : Math.min(100, Math.max(0, Number(confidence)));
  const canSave = !!(name.trim() && pipelineId && stageId && !Number.isNaN(Number(value || 0)));
  const saving = createDeal.isPending || updateDeal.isPending;

  const save = async (overrides: Partial<DealInput> = {}) => {
    if (!canSave) return;
    const targetStage = stageById[overrides.stage_id ?? stageId];
    const payload: DealInput = {
      name: name.trim(),
      value: Number(value || 0),
      currency,
      pipeline_id: pipelineId,
      stage_id: stageId,
      confidence: parsedConfidence,
      expected_close_date: closeDate || null,
      owner_user_id: ownerId === UNASSIGNED ? null : ownerId,
      contact_id: contact?.id ?? null,
      company_id: company?.id ?? null,
      description: description.trim() || null,
      lost_reason: targetStage?.stage_type === "lost" ? lostReason.trim() || null : null,
      ...overrides,
    };
    if (isEdit) await updateDeal.mutateAsync({ id: deal!.id, ...payload });
    else await createDeal.mutateAsync(payload);
    onOpenChange(false);
  };

  const markWon = () => wonStage && save({ stage_id: wonStage.id });
  const reopen = () => openStages.length > 0 && save({ stage_id: openStages[openStages.length - 1].id });

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-[520px]">
          {/* Header: name, value, stage path, close actions */}
          <div className="space-y-4 border-b px-6 pb-5 pt-6">
            <div className="flex items-center gap-2 pr-8 text-xs text-muted-foreground">
              <span>{pipeline?.name ?? "Deal"}</span>
              {closedAs && (
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 font-medium",
                    closedAs === "won"
                      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                      : "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
                  )}
                >
                  {closedAs === "won" ? "Won" : "Lost"}
                  {deal?.closed_at && ` · ${format(new Date(deal.closed_at), "MMM d, yyyy")}`}
                </span>
              )}
            </div>
            <SheetTitle className="sr-only">{isEdit ? "Edit deal" : "New deal"}</SheetTitle>
            <SheetDescription className="sr-only">Deal value, stage, owner and links.</SheetDescription>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Deal name"
              aria-label="Deal name"
              autoFocus={!isEdit}
              className="h-auto border-0 bg-transparent px-0 py-0 text-xl font-semibold tracking-tight shadow-none placeholder:text-muted-foreground/50 focus-visible:ring-0 focus-visible:ring-offset-0"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Input
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="0"
                aria-label="Deal value"
                className="h-10 min-w-0 flex-1 text-lg font-semibold tabular-nums sm:max-w-[180px]"
              />
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger className="h-10 w-[88px]" aria-label="Currency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DEAL_CURRENCIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {Number(value) > 0 && !closedAs && (
                <span className="basis-full text-xs text-muted-foreground sm:ml-1 sm:basis-auto">
                  {formatMoney((Number(value) * (parsedConfidence ?? stage?.win_probability ?? 0)) / 100, currency, true)} weighted
                </span>
              )}
            </div>

            {/* Stage path: click a segment to move the deal */}
            {openStages.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-baseline justify-between text-xs">
                  <span className="font-medium">{closedAs ? `Closed ${closedAs}` : stage?.name}</span>
                  {!closedAs && stageIndex >= 0 && (
                    <span className="text-muted-foreground">
                      Stage {stageIndex + 1} of {openStages.length}
                    </span>
                  )}
                </div>
                <div className="flex gap-1" role="radiogroup" aria-label="Stage">
                  {openStages.map((s, i) => {
                    const reached = closedAs === "won" || (stageIndex >= 0 && i <= stageIndex);
                    return (
                      <Tooltip key={s.id}>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            role="radio"
                            aria-checked={s.id === stageId}
                            aria-label={s.name}
                            onClick={() => setStageId(s.id)}
                            className="group flex-1 py-1.5"
                          >
                            <span
                              className={cn(
                                "block h-1.5 rounded-full transition-all group-hover:h-2",
                                !reached && "bg-muted group-hover:bg-muted-foreground/30",
                              )}
                              style={reached ? { backgroundColor: closedAs === "won" ? "#10b981" : stage?.color } : undefined}
                            />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {s.name}
                          {s.win_probability != null && ` · ${s.win_probability}%`}
                        </TooltipContent>
                      </Tooltip>
                    );
                  })}
                </div>
              </div>
            )}

            {isEdit && (
              <div className="flex gap-2">
                {closedAs ? (
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={reopen} disabled={saving}>
                    <RotateCcw className="h-3.5 w-3.5" /> Reopen deal
                  </Button>
                ) : (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 gap-1.5 border-emerald-500/40 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950"
                      onClick={markWon}
                      disabled={!wonStage || saving || !canSave}
                    >
                      <Trophy className="h-3.5 w-3.5" /> Mark won
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 gap-1.5 border-red-500/40 text-red-700 hover:bg-red-50 hover:text-red-800 dark:text-red-400 dark:hover:bg-red-950"
                      onClick={() => setAskLostReason(true)}
                      disabled={!lostStage || saving || !canSave}
                    >
                      <XCircle className="h-3.5 w-3.5" /> Mark lost
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Body */}
          <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
            {closedAs === "lost" && (
              <Field label="Lost reason" htmlFor="deal-lost-reason">
                <Input
                  id="deal-lost-reason"
                  value={lostReason}
                  onChange={(e) => setLostReason(e.target.value)}
                  placeholder="Price, timing, went with a competitor..."
                />
              </Field>
            )}

            <Section title="Details">
              <div className="grid grid-cols-1 gap-x-3 gap-y-4 sm:grid-cols-2">
                {pipelines.length > 1 && (
                  <Field label="Pipeline" className="sm:col-span-2">
                    <Select value={pipelineId} onValueChange={handlePipelineChange}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {pipelines.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                )}
                <Field label="Expected close" htmlFor="deal-close">
                  <Input id="deal-close" type="date" value={closeDate} onChange={(e) => setCloseDate(e.target.value)} />
                </Field>
                <Field label="Confidence" htmlFor="deal-confidence">
                  <div className="relative">
                    <Input
                      id="deal-confidence"
                      type="number"
                      min={0}
                      max={100}
                      value={confidence}
                      onChange={(e) => setConfidence(e.target.value)}
                      placeholder={stage?.win_probability != null ? String(stage.win_probability) : "-"}
                      className="pr-7"
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
                  </div>
                </Field>
                <Field label="Owner" className="sm:col-span-2">
                  <Select value={ownerId} onValueChange={setOwnerId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Unassigned" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                      {members.map((m) => (
                        <SelectItem key={m.user_id} value={m.user_id}>
                          {m.user?.full_name || m.user?.email || "Member"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              {confidence.trim() === "" && stage?.win_probability != null && !closedAs && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Confidence follows the stage default ({stage.win_probability}%) until you set it.
                </p>
              )}
            </Section>

            <Section
              title="Linked to"
              action={
                isEdit && deal?.contact_id ? (
                  <Link
                    to={`/contacts/${deal.contact_id}`}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    Open contact <ExternalLink className="h-3 w-3" />
                  </Link>
                ) : undefined
              }
            >
              <div className="space-y-2">
                <ContactPicker value={contact} onChange={handleContactChange} />
                <CompanyPicker value={company} onChange={setCompany} />
              </div>
            </Section>

            <Section title="Notes">
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                placeholder="Scope, decision makers, next step..."
                aria-label="Notes"
              />
            </Section>

            {isEdit && history.length > 0 && (
              <Section title="History">
                <ol className="relative ml-1 space-y-3 border-l pl-4">
                  {history.map((h) => {
                    const to = h.to_stage_id ? stageById[h.to_stage_id] : undefined;
                    const from = h.from_stage_id ? stageById[h.from_stage_id] : undefined;
                    return (
                      <li key={h.id} className="relative text-sm">
                        <span
                          className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full ring-4 ring-background"
                          style={{ backgroundColor: to?.color ?? "hsl(var(--muted-foreground))" }}
                        />
                        <div>
                          {h.from_stage_id ? (
                            <>
                              Moved to <span className="font-medium">{to?.name ?? "a deleted stage"}</span>
                              <span className="text-muted-foreground"> from {from?.name ?? "a deleted stage"}</span>
                            </>
                          ) : (
                            <>
                              Created in <span className="font-medium">{to?.name ?? "a deleted stage"}</span>
                            </>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground" title={format(new Date(h.changed_at), "PPpp")}>
                          {formatDistanceToNowStrict(new Date(h.changed_at), { addSuffix: true })}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </Section>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between gap-2 border-t bg-background px-6 py-4">
            {isEdit ? (
              <Button variant="destructive" size="sm" className="gap-1.5" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button variant="cta" onClick={() => save()} disabled={!canSave || saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isEdit ? "Save" : "Create deal"}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <LostReasonDialog
        open={askLostReason}
        dealName={name}
        onCancel={() => setAskLostReason(false)}
        onConfirm={(reason) => {
          setAskLostReason(false);
          if (lostStage) save({ stage_id: lostStage.id, lost_reason: reason || null });
        }}
      />

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this deal?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deal?.name}" and its stage history will be removed. Contact timeline entries stay.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                if (!deal) return;
                await deleteDeal.mutateAsync(deal.id);
                setConfirmDelete(false);
                onOpenChange(false);
              }}
            >
              Delete deal
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2.5 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  htmlFor,
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}
