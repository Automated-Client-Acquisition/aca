import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useState, useCallback, useEffect, useRef } from 'react';

export interface SearchParameter {
  id: string;
  name: string;
  urn?: string;
  type?: string;
}

export type ParameterType = 'location' | 'industry' | 'company' | 'school' | 'skill' | 'function' | 'seniority';

/**
 * Hook to fetch LinkedIn search parameters from Unipile
 *
 * @param accountId - The Unipile account ID to use for the search
 * @param parameterType - The type of parameters to fetch (location, industry, company, etc.)
 * @param keywords - Optional search keywords for type-ahead filtering
 */
export function useLinkedInSearchParams(
  accountId: string | null,
  parameterType: ParameterType,
  keywords?: string
) {
  return useQuery({
    queryKey: ['linkedin-search-params', accountId, parameterType, keywords || ''],
    queryFn: async () => {
      if (!accountId) return [];

      const { data, error } = await supabase.functions.invoke('linkedin-fetch-search-params', {
        body: {
          accountId,
          parameterType,
          keywords: keywords || '',
        },
      });

      if (error) {
        console.error('Failed to fetch search params:', error);
        throw error;
      }

      return (data?.parameters || []) as SearchParameter[];
    },
    enabled: !!accountId,
    staleTime: 60 * 60 * 1000, // 1 hour - parameters don't change often
    gcTime: 24 * 60 * 60 * 1000, // Keep in cache for 24 hours
  });
}

/**
 * Hook for debounced type-ahead search of parameters
 *
 * Provides a debounced search interface for real-time filtering
 * of search parameters as the user types.
 *
 * @param accountId - The Unipile account ID to use for the search
 * @param parameterType - The type of parameters to search
 * @param debounceMs - Debounce delay in milliseconds (default: 300ms)
 */
export function useSearchParamsTypeahead(
  accountId: string | null,
  parameterType: ParameterType,
  debounceMs = 300
) {
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedTerm, setDebouncedTerm] = useState('');
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Debounce search term
  useEffect(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      setDebouncedTerm(searchTerm);
    }, debounceMs);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [searchTerm, debounceMs]);

  const { data: results, isLoading, isFetching } = useLinkedInSearchParams(
    accountId,
    parameterType,
    debouncedTerm
  );

  const handleSearchChange = useCallback((term: string) => {
    setSearchTerm(term);
  }, []);

  const clearSearch = useCallback(() => {
    setSearchTerm('');
    setDebouncedTerm('');
  }, []);

  return {
    searchTerm,
    setSearchTerm: handleSearchChange,
    clearSearch,
    results: results || [],
    isLoading: isLoading || isFetching,
    debouncedTerm,
  };
}

/**
 * Helper to get display label for parameter type
 */
export function getParameterTypeLabel(type: ParameterType): string {
  switch (type) {
    case 'location':
      return 'Location';
    case 'industry':
      return 'Industry';
    case 'company':
      return 'Company';
    case 'school':
      return 'School';
    case 'skill':
      return 'Skill';
    case 'function':
      return 'Job Function';
    case 'seniority':
      return 'Seniority Level';
    default:
      return type;
  }
}

/**
 * Helper to get placeholder text for parameter search
 */
export function getParameterSearchPlaceholder(type: ParameterType): string {
  switch (type) {
    case 'location':
      return 'Search locations (e.g., San Francisco, United States)...';
    case 'industry':
      return 'Search industries (e.g., Technology, Healthcare)...';
    case 'company':
      return 'Search companies (e.g., Google, Microsoft)...';
    case 'school':
      return 'Search schools (e.g., Stanford, MIT)...';
    case 'skill':
      return 'Search skills (e.g., JavaScript, Marketing)...';
    case 'function':
      return 'Search job functions (e.g., Engineering, Sales)...';
    case 'seniority':
      return 'Search seniority levels...';
    default:
      return `Search ${type}...`;
  }
}
