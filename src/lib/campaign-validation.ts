import type { SequenceNode, SequenceEdge, ChannelType } from '@/lib/sequence-utils';
import { validateSequence, getSequenceStats } from '@/lib/sequence-utils';
import { entryRulesErrors, entryAccountErrors, type CampaignEntryRule } from '@/lib/campaign-entry';
import type { SenderAccountsByChannel, CampaignType } from '@/hooks/useCampaigns';

// Campaign data structure
export interface CampaignData {
  entryTriggers?: CampaignEntryRule[];
  name: string;
  description?: string;
  leadListIds: string[];
  exclusionListIds: string[];
  excludeOtherCampaigns: boolean;
  excludeSameSender: boolean;
  // Legacy (LinkedIn only)
  senderAccountIds: string[];
  // Multi-channel
  senderAccounts?: SenderAccountsByChannel;
  campaignType?: CampaignType;
  primaryChannel?: ChannelType;
  channelFallbackEnabled?: boolean;
  fallbackOrder?: ChannelType[];
  // Sequence
  sequenceNodes: SequenceNode[];
  sequenceEdges: SequenceEdge[];
}

// Step validation result
export interface StepValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// Full campaign validation result
export interface CampaignValidationResult {
  valid: boolean;
  canSaveDraft: boolean;
  steps: {
    name: StepValidationResult;
    leads: StepValidationResult;
    senders: StepValidationResult;
    sequence: StepValidationResult;
    triggers: StepValidationResult;
  };
  summary: {
    errors: string[];
    warnings: string[];
  };
}

/**
 * Validate Step 1: Campaign Name
 */
export function validateNameStep(data: Pick<CampaignData, 'name' | 'description'>): StepValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!data.name || data.name.trim().length === 0) {
    errors.push('Campaign name is required');
  } else if (data.name.length > 255) {
    errors.push('Campaign name must be 255 characters or less');
  } else if (data.name.length < 3) {
    warnings.push('Consider using a more descriptive campaign name');
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate Step 2: Lead Selection
 *
 * A campaign needs a source of leads — but a directly attached list is only one
 * of the two ways to get one. The other is a lead list whose processing setup
 * routes its approved leads here; that inflow lives on the list, not on the
 * campaign, and fills it without anything being attached. `hasPipelineInflow`
 * carries that fact in, so a pipeline-fed campaign isn't blocked from launching
 * for missing an attachment it must not have (attaching the same list directly
 * would bypass the pipeline's qualify → enrich → verify gate).
 */
export function validateLeadsStep(
  data: Pick<CampaignData, 'leadListIds' | 'exclusionListIds' | 'excludeOtherCampaigns' | 'excludeSameSender' | 'entryTriggers'>,
  leadListCount?: number,
  hasPipelineInflow?: boolean
): StepValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const hasAttachedLists = (data.leadListIds?.length ?? 0) > 0;

  const hasEntrySource = data.entryTriggers?.some(rule => rule.enabled) && !entryRulesErrors(data.entryTriggers).length;
  if (!hasAttachedLists && !hasPipelineInflow && !hasEntrySource) {
    errors.push(
      "Add a lead source: configure a trigger, attach a lead list, or route a list’s lead processing here"
    );
  }

  // Only meaningful for lists attached here — a pipeline route delivers leads
  // over time, so "empty right now" is not a misconfiguration.
  if (hasAttachedLists && leadListCount === 0 && !hasEntrySource && !hasPipelineInflow) {
    errors.push('Selected lead lists are empty');
  }

  if (data.exclusionListIds.some((id) => data.leadListIds.includes(id))) {
    errors.push('Cannot use the same list as both target and exclusion');
  }

  if (!data.excludeOtherCampaigns && !data.excludeSameSender) {
    warnings.push('Consider enabling exclusion options to avoid contacting leads multiple times');
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate Step 3: Sender Selection (Multi-Channel)
 */
export function validateSendersStep(
  data: Pick<CampaignData, 'senderAccountIds' | 'senderAccounts'>,
  availableAccountsCount?: number
): StepValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Count total selected accounts across all channels
  const totalSelectedAccounts = getTotalSelectedAccounts(data);

  if (totalSelectedAccounts === 0) {
    errors.push('Please select at least one sender account');
  }

  if (availableAccountsCount !== undefined && availableAccountsCount === 0) {
    errors.push('No accounts available. Please connect an account first.');
  }

  if (totalSelectedAccounts > 10) {
    warnings.push('Using many sender accounts may require more careful monitoring');
  }

  // Check if multi-channel campaigns have accounts for each configured channel
  const selectedChannels = getSelectedChannels(data);
  if (selectedChannels.length > 1) {
    warnings.push(`Multi-channel campaign using ${selectedChannels.length} channels`);
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Helper: Get total selected accounts across all channels
 */
function getTotalSelectedAccounts(data: Pick<CampaignData, 'senderAccountIds' | 'senderAccounts'>): number {
  // First check multi-channel senderAccounts
  if (data.senderAccounts && Object.keys(data.senderAccounts).length > 0) {
    return Object.values(data.senderAccounts).reduce(
      (sum, accounts) => sum + (accounts?.length || 0),
      0
    );
  }
  // Fall back to legacy senderAccountIds
  return data.senderAccountIds?.length || 0;
}

/**
 * Helper: Get list of channels with selected accounts
 */
function getSelectedChannels(data: Pick<CampaignData, 'senderAccountIds' | 'senderAccounts'>): ChannelType[] {
  if (data.senderAccounts && Object.keys(data.senderAccounts).length > 0) {
    return Object.keys(data.senderAccounts).filter(
      (ch) => (data.senderAccounts![ch as ChannelType]?.length || 0) > 0
    ) as ChannelType[];
  }
  // Legacy: only LinkedIn
  if (data.senderAccountIds?.length) {
    return ['linkedin'];
  }
  return [];
}

/**
 * Validate Step 4: Sequence
 */
export function validateSequenceStep(
  data: Pick<CampaignData, 'sequenceNodes' | 'sequenceEdges'>
): StepValidationResult {
  // Use the sequence validation from sequence-utils
  const result = validateSequence(data.sequenceNodes, data.sequenceEdges);

  return {
    valid: result.valid,
    errors: result.errors,
    warnings: result.warnings,
  };
}

/**
 * Validate entire campaign
 */
export function validateCampaign(
  data: CampaignData,
  context?: {
    leadListCount?: number;
    availableAccountsCount?: number;
    /** A lead list's processing setup routes its approved leads into this campaign. */
    hasPipelineInflow?: boolean;
  }
): CampaignValidationResult {
  const nameValidation = validateNameStep(data);
  const leadsValidation = validateLeadsStep(data, context?.leadListCount, context?.hasPipelineInflow);
  const sendersValidation = validateSendersStep(data, context?.availableAccountsCount);
  const sequenceValidation = validateSequenceStep(data);
  const senderIds = [...new Set([...(data.senderAccountIds ?? []), ...Object.values(data.senderAccounts ?? {}).flat()])];
  const triggerErrors = [...entryRulesErrors(data.entryTriggers ?? []), ...entryAccountErrors(data.entryTriggers ?? [], senderIds)];
  const triggersValidation = { valid: triggerErrors.length === 0, errors: triggerErrors, warnings: [] };

  const allErrors = [
    ...nameValidation.errors,
    ...leadsValidation.errors,
    ...sendersValidation.errors,
    ...sequenceValidation.errors,
    ...triggerErrors,
  ];

  const allWarnings = [
    ...nameValidation.warnings,
    ...leadsValidation.warnings,
    ...sendersValidation.warnings,
    ...sequenceValidation.warnings,
  ];

  // Can save as draft if at least the name is valid
  const canSaveDraft = nameValidation.valid;

  return {
    valid: allErrors.length === 0,
    canSaveDraft,
    steps: {
      name: nameValidation,
      leads: leadsValidation,
      senders: sendersValidation,
      sequence: sequenceValidation,
      triggers: triggersValidation,
    },
    summary: {
      errors: allErrors,
      warnings: allWarnings,
    },
  };
}

/**
 * Get campaign launch readiness summary
 */
export function getCampaignReadinessSummary(
  data: CampaignData,
  context?: {
    leadListCount?: number;
    leadListName?: string;
    senderAccounts?: { id: string; name: string; dailyLimit: number }[];
  }
): {
  ready: boolean;
  issues: string[];
  summary: {
    leadCount: number;
    senderCount: number;
    estimatedDays: number;
    actionCount: number;
    hasABTesting: boolean;
  };
} {
  const validation = validateCampaign(data, {
    leadListCount: context?.leadListCount,
    availableAccountsCount: context?.senderAccounts?.length,
  });

  const stats = getSequenceStats(data.sequenceNodes);

  return {
    ready: validation.valid,
    issues: [...validation.summary.errors, ...validation.summary.warnings],
    summary: {
      leadCount: context?.leadListCount || 0,
      senderCount: context?.senderAccounts?.length ?? data.senderAccountIds.length,
      estimatedDays: stats.delayDays || 1,
      actionCount: stats.actionCount,
      hasABTesting: stats.hasABTesting,
    },
  };
}

/**
 * Estimate campaign completion time
 */
export function estimateCampaignDuration(
  leadCount: number,
  senderCount: number,
  dailyLimitPerSender: number,
  sequenceDelayDays: number
): {
  minDays: number;
  maxDays: number;
  leadsPerDay: number;
} {
  const totalDailyCapacity = senderCount * dailyLimitPerSender;
  const daysToProcessAllLeads = Math.ceil(leadCount / totalDailyCapacity);

  return {
    minDays: Math.max(sequenceDelayDays, daysToProcessAllLeads),
    maxDays: sequenceDelayDays + daysToProcessAllLeads,
    leadsPerDay: totalDailyCapacity,
  };
}
