export interface SortConfig {
  column: string | null;
  direction: 'asc' | 'desc' | null;
}

export function getNestedValue(obj: any, path: string): any {
  return path.split('.').reduce((current, key) => current?.[key], obj);
}

export function sortData<T>(
  data: T[],
  sortConfig: SortConfig,
  sortFn?: (a: any, b: any) => number
): T[] {
  if (!sortConfig.column || !sortConfig.direction) return data;
  
  return [...data].sort((a, b) => {
    const aVal = getNestedValue(a, sortConfig.column!);
    const bVal = getNestedValue(b, sortConfig.column!);
    
    // Handle nulls - always push to end
    if (aVal === null || aVal === undefined) return 1;
    if (bVal === null || bVal === undefined) return -1;
    
    // Use custom sort function if provided
    if (sortFn) {
      return sortFn(aVal, bVal) * (sortConfig.direction === 'desc' ? -1 : 1);
    }
    
    // Default comparison
    if (typeof aVal === 'string' && typeof bVal === 'string') {
      const comparison = aVal.toLowerCase().localeCompare(bVal.toLowerCase());
      return sortConfig.direction === 'asc' ? comparison : -comparison;
    }
    
    if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
    if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
    return 0;
  });
}

export function getStorageKey(tableName: string): string {
  return `${tableName}_columnConfig`;
}

export function loadColumnConfig(tableName: string): { visible: string[]; order: string[] } | null {
  try {
    const saved = localStorage.getItem(getStorageKey(tableName));
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (error) {
    console.error('Error loading column config:', error);
  }
  return null;
}

export function saveColumnConfig(tableName: string, visible: string[], order: string[]): void {
  try {
    localStorage.setItem(getStorageKey(tableName), JSON.stringify({ visible, order }));
  } catch (error) {
    console.error('Error saving column config:', error);
  }
}

export function formatDate(date: string | null): string {
  if (!date) return '-';
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

export function formatNumber(num: number | null): string {
  if (num === null || num === undefined) return '-';
  return new Intl.NumberFormat('en-US').format(num);
}

export function formatDuration(seconds: number | null): string {
  if (!seconds) return '-';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
