import { useEffect, useRef, useState } from "react";

export function useAutosave<T>(
  callback: (data: T) => void | Promise<void>,
  data: T,
  delay: number = 1000,
  enabled: boolean = true
) {
  const [isSaving, setIsSaving] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout>();
  const previousDataRef = useRef<T>(data);

  useEffect(() => {
    if (!enabled) return;
    
    // Check if data has actually changed
    if (JSON.stringify(data) === JSON.stringify(previousDataRef.current)) {
      return;
    }

    // Clear existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // Set new timeout for autosave
    timeoutRef.current = setTimeout(async () => {
      if (Object.keys(data as any).length > 0) {
        setIsSaving(true);
        try {
          await callback(data);
          previousDataRef.current = data;
        } finally {
          setIsSaving(false);
        }
      }
    }, delay);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [data, delay, enabled]);

  return { isSaving };
}
