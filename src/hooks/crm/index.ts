// CRM Hooks - Re-export all hooks from individual files

// Contacts
export {
  useContacts,
  useContactsByStage,
  useCreateContact,
  useUpdateContact,
  useMoveContactToStage,
  useDeleteContact,
  useArchiveContact,
  useBulkUpdateContacts,
  useAddContactTag,
  useRemoveContactTag,
  type CrmContact,
  type CrmContactIdentity,
  type CrmPipeline,
  type CrmPipelineStage,
  type ContactFilters,
  type CreateContactInput,
  type UpdateContactInput,
} from './useContacts';

// Single Contact Details
export {
  useContact,
  useAddContactIdentity,
  useRemoveContactIdentity,
  useAddNote,
  useUpdateNote,
  useDeleteNote,
  useToggleNotePin,
  useContactActivities as useContactActivitiesPaginated,
  useLogActivity as useLogContactActivity,
  type CrmActivity,
  type CrmNote,
  type ContactWithDetails,
  type AddIdentityInput,
  type AddNoteInput,
} from './useContact';

// Pipelines
export {
  usePipelines,
  usePipeline,
  useDefaultPipeline,
  useCreatePipeline,
  useUpdatePipeline,
  useDeletePipeline,
  usePipelineStages,
  useCreateStage,
  useUpdateStage,
  useDeleteStage,
  useReorderStages,
  type PipelineWithStages,
  type CreatePipelineInput,
  type UpdatePipelineInput,
  type CreateStageInput,
  type UpdateStageInput,
} from './usePipeline';

// Tags
export {
  useTags,
  useTag,
  useSearchTags,
  useCreateTag,
  useUpdateTag,
  useDeleteTag,
  useContactTags,
  useTagContacts,
  useBulkAddTag,
  useBulkRemoveTag,
  useCreateTagAndAssign,
  type CrmTag,
  type CrmContactTag,
  type TagWithCount,
  type CreateTagInput,
  type UpdateTagInput,
} from './useTags';

// Activities
export {
  useContactActivities,
  useContactActivitiesInfinite,
  useActivities,
  useActivityFeed,
  useLogActivity,
  useLogStageChange,
  useLogMessageActivity,
  useActivityStats,
  useDeleteActivity,
  type ActivityType,
  type PerformerType,
  type ActivityWithContact,
  type CreateActivityInput,
  type ActivityFilters,
} from './useActivities';

// Conversations
export {
  useConversations,
  useConversationsInfinite,
  useFavoriteConversations,
  useConversation,
  useContactConversations,
  useUnreadConversationCount,
  useCreateConversation,
  useUpdateConversation,
  useMarkConversationRead,
  useCloseConversation,
  useReopenConversation,
  useSnoozeConversation,
  useAssignConversation,
  useToggleConversationAI,
  useGetOrCreateConversation,
  useStartConversation,
  useBatchConversationActions,
  type ConversationChannel,
  type ConversationStatus,
  type AssignedToType,
  type CrmConversation,
  type ConversationWithContact,
  type ConversationFilters,
  type CreateConversationInput,
  type UpdateConversationInput,
  type StartConversationResult,
  type StartConversationInput,
} from './useConversations';

// Conversation Preferences
export {
  useConversationPreferences,
  useFavoriteConversationIds,
  useConversationPreference,
  useToggleFavorite,
  useUpdateConversationLabels,
  useToggleMute,
  type ConversationPreference,
} from './useConversationPreferences';

// Messages
export {
  useMessages,
  useMessagesInfinite,
  useMessage,
  useSearchMessages,
  useSendMessage,
  useQueueMessage,
  useRecordInboundMessage,
  useUpdateMessageStatus,
  useDeleteMessage,
  useMessageStats,
  type MessageDirection,
  type MessageSenderType,
  type MessageContentType,
  type MessageStatus,
  type MessageAttachment,
  type CrmMessage,
  type SendMessageInput,
  type QueueMessageInput,
} from './useMessages';

// Message Queue
export {
  useMessageQueue,
  usePendingQueueCount,
  useFailedQueueItems,
  useQueueItem,
  useCancelQueueItem,
  useRetryQueueItem,
  useBulkCancelQueue,
  useBulkRetryQueue,
  useDeleteQueueItem,
  useQueueStats,
  useRescheduleQueueItem,
  useUpdateQueuePriority,
  type QueueStatus,
  type QueueSourceType,
  type CrmMessageQueueItem,
  type QueueItemWithContact,
  type QueueFilters,
} from './useMessageQueue';

// Sequences
export {
  useSequences,
  useSequence,
  useCreateSequence,
  useUpdateSequence,
  useDeleteSequence,
  useToggleSequenceStatus,
  useDuplicateSequence,
  useSequenceStats,
  useCreateStep,
  useUpdateStep,
  useDeleteStep,
  useReorderSteps,
  useSequenceEnrollments,
  useContactEnrollments,
  useEnrollInSequence,
  useToggleEnrollmentPause,
  useRemoveFromSequence,
  useBulkEnroll,
  useEnrollmentLogs,
  getStepTypeLabel,
  getStepIcon,
  getEnrollmentStatusLabel,
  type SequenceStatus,
  type StepType,
  type EnrollmentStatus,
  type CrmSequence,
  type SequenceStep,
  type SequenceEnrollment,
  type SequenceLog,
  type SequenceWithStats,
  type CreateSequenceInput,
  type UpdateSequenceInput,
  type StepInput,
} from './useSequences';

// Rules
export {
  useRules,
  useRule,
  useCreateRule,
  useUpdateRule,
  useDeleteRule,
  useToggleRuleStatus,
  useDuplicateRule,
  useRuleLogs,
  useHandoffTriggers,
  useHandoffTrigger,
  useCreateHandoffTrigger,
  useUpdateHandoffTrigger,
  useDeleteHandoffTrigger,
  useToggleHandoffTriggerStatus,
  useDuplicateHandoffTrigger,
  useHandoffLogs,
  useManualHandoff,
  getTriggerTypeLabel,
  getActionTypeLabel,
  getConditionOperatorLabel,
  getConditionFieldLabel,
  getHandoffTriggerTypeLabel,
  createEmptyConditionGroup,
  createEmptyCondition,
  createEmptyAction,
  type RuleTriggerType,
  type RuleConditionOperator,
  type RuleConditionField,
  type RuleActionType,
  type RuleCondition,
  type RuleConditionGroup,
  type RuleAction,
  type CrmAutomationRule,
  type RuleLog,
  type CreateRuleInput,
  type UpdateRuleInput,
  type HandoffTrigger,
  type CreateHandoffTriggerInput,
  type HandoffLog,
} from './useRules';

// Webhooks
export {
  useWebhookSettings,
  useCreateWebhookSettings,
  useUpdateWebhookSettings,
  useToggleWebhookActive,
  useGenerateWebhookSecret,
  useWebhookLogs,
  useRetryWebhook,
  useWebhookStats,
  useWebhookSubscriptions,
  useLeadListNames,
  useDeleteWebhookSubscription,
  destinationStatus,
  ALL_WEBHOOK_EVENTS,
  getEventTypeLabel,
  getEventTypeDescription,
  type WebhookEventType,
  type WebhookSettings,
  type WebhookEventLog,
  type WebhookSubscription,
  type DestinationHealth,
  type CreateWebhookSettingsInput,
  type UpdateWebhookSettingsInput,
} from './useWebhooks';

// AI Draft
export {
  useAiDraft,
  type AiDraftInput,
  type AiDraftResult,
} from './useAiDraft';

// Autopilot Queue
export {
  useAutopilotQueue,
  useAutopilotQueueCount,
  useConversationAutopilotItems,
  useApproveAutopilotItem,
  type AutopilotQueueStatus,
  type AutopilotQueueItem,
  type ApproveAutopilotInput,
  type ApproveAutopilotResult,
} from './useAutopilotQueue';

// Unified Messages
export {
  useUnifiedMessages,
  type UnifiedMessage,
} from './useUnifiedMessages';

// Response Time Stats
export {
  useResponseTimeStats,
  type ResponseTimeStats,
} from './useResponseTimeStats';
