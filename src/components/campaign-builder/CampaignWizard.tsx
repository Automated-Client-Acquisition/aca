import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, AlertTriangle, Check, ChevronRight, Loader2, Rocket, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { WizardNavigation } from "@/components/campaign-builder/WizardNavigation";
import { Step1Name } from "@/components/campaign-builder/Step1Name";
import { Step2Leads } from "@/components/campaign-builder/Step2Leads";
import { StepTriggers } from "@/components/campaign-builder/StepTriggers";
import { Step3Senders } from "@/components/campaign-builder/Step3Senders";
import { Step4Sequence } from "@/components/campaign-builder/Step4Sequence";
import { Step5Settings } from "@/components/campaign-builder/Step5Settings";
import { StepReview } from "@/components/campaign-builder/StepReview";
import { CampaignStatusBadge } from "@/components/campaigns/CampaignStatusBadge";
import type { CampaignBuilderReturn } from "@/hooks/useCampaignBuilder";
import { WIZARD_STEPS, STEP_LABELS } from "@/hooks/useCampaignBuilder";
import { useStartCampaign, type CampaignStatus, type LinkedInCampaign } from "@/hooks/useCampaigns";
import { useAccountsWithLimits } from "@/hooks/useAccountsWithLimits";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { campaignWritePayload, campaignEditorNameError, normalizeCampaignEditorSnapshot, unavailableCampaignSenderChannels, createCampaignSaveQueue, type CampaignSaveStatus } from "@/lib/campaign-persistence";
import { cn } from "@/lib/utils";
import { entryAccountErrors } from "@/lib/campaign-entry";

interface CampaignWizardProps {
  builder: CampaignBuilderReturn;
  campaignId?: string;
  campaignStatus?: CampaignStatus;
  existingCampaign?: LinkedInCampaign;
}
type EditorSnapshot = ReturnType<CampaignBuilderReturn["getCampaignData"]>;
type SaveQueue = ReturnType<typeof createCampaignSaveQueue<EditorSnapshot>>;

export function CampaignWizard({ builder, campaignId, campaignStatus, existingCampaign }: CampaignWizardProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { currentOrganization, user } = useAuth();
  const { data: accounts, isLoading: accountsLoading, error: accountsError, refetch: refetchAccounts } = useAccountsWithLimits();
  const startCampaign = useStartCampaign();
  const isEditing = !!campaignId;
  const readOnly = campaignStatus === "completed";
  const isRunning = campaignStatus === "active" || campaignStatus === "paused";
  const isSequenceStep = builder.currentStep === "sequence";
  const [saveStatus, setSaveStatus] = useState<CampaignSaveStatus>(isEditing ? "saved" : "unsaved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [workflowPending, setWorkflowPending] = useState(false);
  const mountedRef = useRef(true);
  // The page mounts after hydration and keys by organization/campaign. In-flight
  // work retains that original owner when the user changes routes or workspaces.
  const scopeRef = useRef({ organizationId: currentOrganization?.id, userId: user?.id });
  const persistedIdRef = useRef(campaignId);
  const savedNodeIdsRef = useRef((existingCampaign?.sequence_nodes || []).map(node => node.id));
  const builderRef = useRef(builder);
  builderRef.current = builder;
  const campaignStatusRef = useRef(campaignStatus);
  campaignStatusRef.current = campaignStatus;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigationPendingRef = useRef(false);
  const queueRef = useRef<SaveQueue | null>(null);
  const { getCampaignData } = builder;
  const snapshot = useMemo(() => normalizeCampaignEditorSnapshot(getCampaignData()), [getCampaignData]);
  const accountsRef = useRef({ data: accounts, error: accountsError, isLoading: accountsLoading });
  accountsRef.current = { data: accounts, error: accountsError, isLoading: accountsLoading };

  if (!queueRef.current) {
    queueRef.current = createCampaignSaveQueue(snapshot, async (draft) => {
      const { organizationId, userId } = scopeRef.current;
      if (!organizationId) throw new Error("Choose a workspace before saving this campaign.");
      if (campaignStatusRef.current === "completed") throw new Error("Completed campaigns cannot be edited.");
      const nameError = campaignEditorNameError(draft.name);
      if (nameError) throw new Error(nameError);
      const payload = { ...campaignWritePayload(draft), updated_at: new Date().toISOString() };
      let saved: LinkedInCampaign;
      if (persistedIdRef.current) {
        const { data, error } = await supabase.from("linkedin_campaigns").update(payload)
          .eq("id", persistedIdRef.current).eq("organization_id", organizationId).neq("status", "completed")
          .select("*, lead_list:lead_lists(id, name, lead_count)").single();
        if (error) throw error;
        saved = data as unknown as LinkedInCampaign;
      } else {
        const { data, error } = await supabase.from("linkedin_campaigns")
          .insert({ ...payload, name: draft.name, organization_id: organizationId, created_by: userId || null })
          .select("*, lead_list:lead_lists(id, name, lead_count)").single();
        if (error) throw error;
        saved = data as unknown as LinkedInCampaign;
        persistedIdRef.current = saved.id;
      }
      const detailKey = ["linkedin-campaign", organizationId, saved.id];
      await queryClient.cancelQueries({ queryKey: detailKey });
      queryClient.setQueryData(detailKey, saved);
      queryClient.invalidateQueries({ queryKey: ["linkedin-campaigns", organizationId] });
      const nextNodeIds = draft.sequence_nodes.map(node => node.id);
      const deletedIds = savedNodeIdsRef.current.filter(id => !nextNodeIds.includes(id));
      // The scoped update+single verifies the parent before this legacy SECURITY
      // DEFINER RPC. Retain the baseline until remapping has actually succeeded.
      if ((saved.status === "active" || saved.status === "paused") && deletedIds.length) {
        const { data, error } = await supabase.rpc("remap_leads_on_sequence_change", {
          p_campaign_id: saved.id, p_old_node_ids: deletedIds,
        });
        if (error) throw new Error("Campaign saved, but leads on removed steps could not be updated. Retry save to finish.");
        const remapped = (Array.isArray(data) ? data[0] : data)?.leads_remapped || 0;
        if (remapped > 0) toast.info(`${remapped} lead${remapped === 1 ? "" : "s"} moved from removed steps to the sequence start.`);
        for (const key of ["campaign-progress", "campaign-progress-paginated", "campaign-progress-stats"]) {
          queryClient.invalidateQueries({ queryKey: [key, saved.id, organizationId] });
        }
        queryClient.invalidateQueries({ queryKey: detailKey });
      }
      savedNodeIdsRef.current = nextNodeIds;
    }, (status, error) => {
      const message = error instanceof Error ? error.message
        : error ? "Your changes could not be saved. Retry to keep your changes." : null;
      if (mountedRef.current) { setSaveStatus(status); setSaveError(message); }
      else if (status === "error") toast.error(message || "Campaign changes could not be saved.", {
        action: { label: "Retry save", onClick: () => { void queueRef.current?.flush().catch(() => {}); } },
      });
    });
  }
  const queue = queueRef.current;
  const flushSave = async (force = false) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    // Include edits from the latest render, even during an earlier request.
    queue.update(normalizeCampaignEditorSnapshot(builderRef.current.getCampaignData()));
    await queue.flush(force);
  };
  useEffect(() => {
    queue.update(snapshot);
    if (!isEditing || readOnly || campaignEditorNameError(snapshot.name) || !queue.hasUnsavedChanges()) return;
    timerRef.current = setTimeout(() => { void queue.flush().catch(() => {}); }, 1000);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [snapshot, queue, isEditing, readOnly]);
  useEffect(() => {
    mountedRef.current = true;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (queue.hasUnsavedChanges()) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      mountedRef.current = false;
      window.removeEventListener("beforeunload", beforeUnload);
      if (timerRef.current) clearTimeout(timerRef.current);
      const canPersist = !campaignEditorNameError(builderRef.current.state.name);
      if (campaignStatusRef.current !== "completed" && canPersist
        && (persistedIdRef.current || queue.hasUnsavedChanges())) void queue.flush(!persistedIdRef.current).catch(() => {});
    };
  }, [queue]);

  useEffect(() => {
    const saveBeforeInternalLink = (event: globalThis.MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
        || campaignStatusRef.current === "completed") return;
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!anchor || anchor.hasAttribute("download") || (anchor.target && anchor.target !== "_self")) return;
      const destination = new URL(anchor.href, window.location.href);
      if (destination.origin !== window.location.origin || !["http:", "https:"].includes(destination.protocol)
        || (destination.pathname === window.location.pathname && destination.search === window.location.search)) return;
      queue.update(normalizeCampaignEditorSnapshot(builderRef.current.getCampaignData()));
      if (!queue.hasUnsavedChanges() && !navigationPendingRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      if (navigationPendingRef.current) return;
      const nameError = campaignEditorNameError(builderRef.current.state.name);
      if (nameError) { toast.error(nameError); builderRef.current.goToStep("name"); return; }
      navigationPendingRef.current = true;
      setWorkflowPending(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      void queue.flush(!persistedIdRef.current).then(() => {
        if (mountedRef.current) navigate(`${destination.pathname}${destination.search}${destination.hash}`);
      }).catch(() => {}).finally(() => {
        navigationPendingRef.current = false;
        if (mountedRef.current) setWorkflowPending(false);
      });
    };
    document.addEventListener("click", saveBeforeInternalLink, true);
    return () => document.removeEventListener("click", saveBeforeInternalLink, true);
  }, [queue, navigate]);

  const unavailableChannels = accounts ? unavailableCampaignSenderChannels(
    builder.state.senderAccounts, builder.state.senderAccountIds, accounts.accounts,
  ) : [];
  const entryAccountError = accounts ? entryAccountErrors(builder.state.entryTriggers, [...builder.state.senderAccountIds, ...Object.values(builder.state.senderAccounts).flat()], accounts.accounts)[0] : undefined;
  const launchSenderError = entryAccountError || (accountsError ? "Sender accounts could not be checked. Retry before launching."
    : accountsLoading || !accounts ? "Checking sender availability…"
    : unavailableChannels.length ? `Choose a connected sender for ${unavailableChannels.join(", ")} before launching.` : null);
  const isSaving = saveStatus === "saving";
  const busy = workflowPending || startCampaign.isPending;

  const saveChanges = async () => {
    if (readOnly || !builderRef.current.validation.canSaveDraft) return;
    setWorkflowPending(true);
    try {
      await flushSave(!persistedIdRef.current);
      if (!mountedRef.current) return;
      toast.success("Campaign saved");
      if (mountedRef.current && !isEditing && persistedIdRef.current) navigate(`/campaigns/${persistedIdRef.current}`);
    } catch { /* Keep the draft and expose Retry save. */ }
    finally { if (mountedRef.current) setWorkflowPending(false); }
  };
  const exitEditor = async () => {
    if (busy || navigationPendingRef.current) return;
    const nameError = campaignEditorNameError(builderRef.current.state.name);
    if (!readOnly && nameError && (persistedIdRef.current || queue.hasUnsavedChanges())) { toast.error(nameError); builderRef.current.goToStep("name"); return; }
    navigationPendingRef.current = true;
    setWorkflowPending(true);
    try {
      if (!readOnly && (persistedIdRef.current || builderRef.current.validation.canSaveDraft)) await flushSave(!persistedIdRef.current);
      if (mountedRef.current) navigate(persistedIdRef.current ? `/campaigns/${persistedIdRef.current}` : "/campaigns");
    } catch { /* Stay with the retained edits on failure. */ }
    finally { navigationPendingRef.current = false; if (mountedRef.current) setWorkflowPending(false); }
  };
  const backClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    void exitEditor();
  };
  const launch = async () => {
    if (readOnly || busy || isRunning || launchSenderError || !builderRef.current.validation.valid) return;
    setWorkflowPending(true);
    try {
      await flushSave(!persistedIdRef.current);
      if (!mountedRef.current) return;
      if (!builderRef.current.validation.valid) throw new Error("Review the latest changes before launching.");
      const latestAccounts = accountsRef.current;
      const latestDraft = builderRef.current.state;
      if (latestAccounts.error || latestAccounts.isLoading || !latestAccounts.data
        || unavailableCampaignSenderChannels(latestDraft.senderAccounts, latestDraft.senderAccountIds, latestAccounts.data.accounts).length
        || entryAccountErrors(latestDraft.entryTriggers, [...latestDraft.senderAccountIds, ...Object.values(latestDraft.senderAccounts).flat()], latestAccounts.data.accounts).length) {
        throw new Error("Check your selected sender accounts before launching.");
      }
      if (persistedIdRef.current) {
        await startCampaign.mutateAsync(persistedIdRef.current);
        if (mountedRef.current) navigate(`/campaigns/${persistedIdRef.current}`);
      }
    } catch (error) {
      if (error instanceof Error && ["Review the latest changes before launching.", "Check your selected sender accounts before launching."].includes(error.message)) toast.error(error.message);
    } finally { if (mountedRef.current) setWorkflowPending(false); }
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <header className="shrink-0 border-b bg-card px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="w-full min-w-0 sm:w-auto sm:flex-1">
            <nav aria-label="Breadcrumb" className="mb-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Link to={campaignId ? `/campaigns/${campaignId}` : "/campaigns"} onClick={backClick} className="inline-flex items-center gap-1 hover:text-foreground">
                <ArrowLeft className="h-3 w-3" />{isEditing ? "Campaign overview" : "Campaigns"}
              </Link><ChevronRight className="h-3 w-3" /><span>{isEditing ? "Editing" : "New campaign"}</span>
            </nav>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h1 className="min-w-0 max-w-full break-words text-base font-semibold tracking-tight sm:text-lg" title={builder.state.name}>{builder.state.name.trim() || "Untitled campaign"}</h1>
              {campaignStatus && <CampaignStatusBadge status={campaignStatus} className="px-2 py-0.5 text-[10px]" />}
            </div>
          </div>
          <div className="flex w-full flex-wrap items-center justify-between gap-2 sm:w-auto sm:justify-end">
            <span role="status" aria-live="polite" className={cn("inline-flex items-center gap-1.5 text-xs", saveStatus === "error" ? "text-destructive" : "text-muted-foreground")}>
              {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saveStatus === "error" ? <AlertTriangle className="h-3.5 w-3.5" /> : persistedIdRef.current && saveStatus === "saved" ? <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" /> : null}
              {isSaving ? "Saving…" : saveStatus === "error" ? "Save failed" : persistedIdRef.current && saveStatus === "saved" ? "Saved" : !persistedIdRef.current && !queue.hasUnsavedChanges() ? "Draft not saved" : "Unsaved changes"}
            </span>
            <Button variant="outline" size="sm" onClick={() => void exitEditor()} disabled={busy}>Done</Button>
            {!readOnly && <Button variant="cta" size="sm" onClick={() => void saveChanges()} disabled={busy || isSaving || !builder.validation.canSaveDraft}>
              {busy || isSaving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}{isEditing ? "Save changes" : "Save draft"}
            </Button>}
          </div>
        </div>
        {isRunning && <p className="mt-2 flex items-start gap-1.5 text-xs leading-5 text-muted-foreground"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" /><span className="sm:hidden">{campaignStatus === "active" ? "Active" : "Paused"} campaign · edits apply on the next processing cycle.</span><span className="hidden sm:inline">Editing {campaignStatus === "active" ? "an active" : "a paused"} campaign. Changes apply on the next processing cycle; contacted leads keep their sender.</span></p>}

        {saveStatus === "error" && <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs" role="alert">
          <p className="min-w-0 flex-1 text-destructive">{saveError || "Your changes are still here, but have not been saved."}</p>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => void flushSave().catch(() => {})}>Retry save</Button>
        </div>}
      </header>
      <WizardNavigation currentStep={builder.currentStep} onStepClick={builder.goToStep} isStepValid={builder.isStepValid} showIssues={isEditing || builder.currentStep === "review"}
        completedSteps={isEditing ? WIZARD_STEPS.filter(step => step !== builder.currentStep && builder.isStepValid(step)) : []} />
      <div className={cn("min-h-0 flex-1", isSequenceStep ? "overflow-hidden" : "overflow-y-auto")}>
        <div className={cn("h-full min-h-0", !isSequenceStep && "mx-auto max-w-[1040px] p-4 sm:p-6")}>
          <fieldset disabled={readOnly || busy} className="h-full min-h-0 min-w-0">
            {builder.currentStep === "name" && <Step1Name builder={builder} />}
            {builder.currentStep === "leads" && <Step2Leads builder={builder} campaignId={campaignId} />}
            {builder.currentStep === "triggers" && <StepTriggers builder={builder} campaignId={campaignId} active={campaignStatus === "active"} />}
            {builder.currentStep === "senders" && <Step3Senders builder={builder} />}
            {builder.currentStep === "sequence" && <Step4Sequence builder={builder} />}
            {builder.currentStep === "settings" && <Step5Settings builder={builder} campaignId={campaignId} />}
            {builder.currentStep === "review" && <StepReview builder={builder} campaignId={campaignId} campaignStatus={campaignStatus} />}
          </fieldset>
        </div>
      </div>
      <footer className="shrink-0 border-t bg-card px-4 py-3 sm:px-6">
        {builder.isLastStep && !isRunning && !readOnly && launchSenderError && <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground" role="status">
          <span>{launchSenderError}</span>{accountsError && <Button variant="outline" size="sm" onClick={() => refetchAccounts()}>Retry senders</Button>}
        </div>}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">{STEP_LABELS[builder.currentStep]}</span><span className="ml-2 hidden sm:inline">{builder.currentStepIndex + 1} of {WIZARD_STEPS.length}</span></p>
          <div className="flex items-center gap-2">
            {builder.canGoPrevious && <Button variant="outline" size="sm" onClick={builder.goToPreviousStep} disabled={busy}><ArrowLeft className="mr-1.5 h-3.5 w-3.5" />Previous</Button>}
            {builder.isLastStep ? !isRunning && !readOnly && <Button variant="cta" size="sm" onClick={() => void launch()} disabled={busy || isSaving || !builder.validation.valid || !!launchSenderError}>
              {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Rocket className="mr-1.5 h-3.5 w-3.5" />}{busy ? "Launching…" : "Launch campaign"}
            </Button> : <Button variant="outline" size="sm" onClick={builder.goToNextStep} disabled={busy || !builder.canGoNext}>Next section<ArrowRight className="ml-1.5 h-3.5 w-3.5" /></Button>}
          </div>
        </div>
      </footer>
    </div>
  );
}
