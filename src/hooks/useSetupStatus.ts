import { useMemo } from "react";
import { useApiKeys } from "./useApiKeys";
import { useStorageCredentials } from "./useStorageCredentials";

export interface SetupStatus {
  // Individual statuses
  hasOpenRouter: boolean;
  hasReplicate: boolean;
  hasStorage: boolean;

  // Aggregate status
  isComplete: boolean;
  isLoading: boolean;

  // Missing items for display
  missingItems: {
    id: string;
    label: string;
    description: string;
    link: string;
  }[];

  // Progress
  completedCount: number;
  totalRequired: number;
}

export function useSetupStatus(): SetupStatus {
  const { data: apiKeys, isLoading: apiKeysLoading } = useApiKeys();
  const { data: storageCredentials, isLoading: storageLoading } = useStorageCredentials();

  return useMemo(() => {
    const isLoading = apiKeysLoading || storageLoading;

    // Check for valid API keys
    const hasOpenRouter = apiKeys?.some(
      (key) => key.provider === "openrouter" && key.is_valid
    ) ?? false;

    const hasReplicate = apiKeys?.some(
      (key) => key.provider === "replicate" && key.is_valid
    ) ?? false;

    // Check for active storage
    const hasStorage = storageCredentials?.some(
      (cred) => cred.is_active
    ) ?? false;

    // OpenRouter is the only universally-required key — the system can't
    // generate replies, draft messages, or run any LLM work without it.
    // Replicate (image/video gen) and Cloud Storage (saving generated media)
    // are only needed if the user runs the content side; for outreach-only
    // trial users they're optional and live in the activation checklist
    // as 'Optional' instead of blocking 'setup' requirements.
    const missingItems: SetupStatus["missingItems"] = [];

    if (!hasOpenRouter) {
      missingItems.push({
        id: "openrouter",
        label: "OpenRouter",
        description: "Required for AI replies, content, and agent reasoning",
        link: "/settings?tab=integrations",
      });
    }

    const completedCount = hasOpenRouter ? 1 : 0;
    const totalRequired = 1;
    const isComplete = completedCount === totalRequired;

    return {
      hasOpenRouter,
      hasReplicate,
      hasStorage,
      isComplete,
      isLoading,
      missingItems,
      completedCount,
      totalRequired,
    };
  }, [apiKeys, storageCredentials, apiKeysLoading, storageLoading]);
}
