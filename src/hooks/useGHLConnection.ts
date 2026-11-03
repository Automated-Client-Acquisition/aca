import { useQuery } from "@tanstack/react-query";
import { useApiKeys } from "./useApiKeys";

interface GHLAccount {
  id: string;
  type: string;
  name: string;
  username?: string;
}

export function useGHLConnection() {
  const { data: apiKeys = [] } = useApiKeys();
  
  return useQuery({
    queryKey: ['ghl-connection', apiKeys],
    queryFn: async () => {
      const ghlKey = apiKeys.find(k => k.provider === 'leadconnector');
      
      if (!ghlKey) {
        return { connected: false, accounts: [] };
      }

      // The validation response includes connected accounts
      // We can decode the JWT to get basic info
      try {
        // Note: In a real scenario, you'd want to fetch this from the backend
        // For now, we'll just indicate connection status
        return {
          connected: true,
          locationId: 'Decoded from JWT',
          accounts: [] as GHLAccount[], // Will be populated from backend
        };
      } catch (error) {
        return { connected: false, accounts: [] };
      }
    },
    enabled: apiKeys.length > 0,
  });
}
