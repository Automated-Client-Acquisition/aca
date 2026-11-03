import { useState, useRef, useCallback, useEffect } from "react";

interface ColumnResizeConfig {
  /** Unique key for localStorage persistence, e.g. "contacts-table" */
  tableId: string;
  /** Default widths for each column key, in pixels */
  defaultWidths: Record<string, number>;
  /** Minimum column width in pixels. Default: 50 */
  minWidth?: number;
  /** Maximum column width in pixels. Default: 800 */
  maxWidth?: number;
}

interface ColumnResizeResult {
  /** Current column widths (persisted). Keyed by column key string. */
  columnWidths: Record<string, number>;
  /** Returns style props for the <table> element */
  getTableProps: (visibleKeys: string[]) => { style: React.CSSProperties };
  /** Returns style props for a <th> element */
  getHeaderProps: (columnKey: string) => { style: React.CSSProperties };
  /** Returns props for the resize handle */
  getResizeHandleProps: (columnKey: string) => {
    onMouseDown: (e: React.MouseEvent) => void;
    onDoubleClick: (e: React.MouseEvent) => void;
    isResizing: boolean;
  };
  /** Whether any column is currently being resized */
  isResizing: boolean;
  /** Reset all columns to default widths */
  resetWidths: () => void;
}

const DEFAULT_MIN_WIDTH = 50;
const DEFAULT_MAX_WIDTH = 800;
const DEFAULT_FALLBACK_WIDTH = 150;

function loadWidths(tableId: string): Record<string, number> | null {
  try {
    const saved = localStorage.getItem(`${tableId}-column-widths`);
    if (saved) return JSON.parse(saved);
  } catch {
    // ignore
  }
  return null;
}

function saveWidths(tableId: string, widths: Record<string, number>) {
  try {
    localStorage.setItem(`${tableId}-column-widths`, JSON.stringify(widths));
  } catch {
    // ignore
  }
}

export function useColumnResize({
  tableId,
  defaultWidths,
  minWidth = DEFAULT_MIN_WIDTH,
  maxWidth = DEFAULT_MAX_WIDTH,
}: ColumnResizeConfig): ColumnResizeResult {
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(
    () => {
      const saved = loadWidths(tableId);
      if (saved) {
        // Merge: use saved values where they exist, defaults for new columns
        return { ...defaultWidths, ...saved };
      }
      return { ...defaultWidths };
    }
  );

  const [activeColumn, setActiveColumn] = useState<string | null>(null);

  // Mutable refs for drag state to avoid re-renders on every mousemove
  const dragRef = useRef<{
    startX: number;
    startWidth: number;
    columnKey: string;
    rafId: number | null;
  } | null>(null);

  const columnWidthsRef = useRef(columnWidths);
  columnWidthsRef.current = columnWidths;

  const getWidth = useCallback(
    (key: string) => {
      return columnWidths[key] ?? defaultWidths[key] ?? DEFAULT_FALLBACK_WIDTH;
    },
    [columnWidths, defaultWidths]
  );

  const getTableProps = useCallback(
    (visibleKeys: string[]) => {
      const totalWidth = visibleKeys.reduce(
        (sum, key) => sum + getWidth(key),
        0
      );
      return {
        style: {
          tableLayout: "fixed" as const,
          width: `${totalWidth}px`,
        },
      };
    },
    [getWidth]
  );

  const getHeaderProps = useCallback(
    (columnKey: string) => {
      return {
        style: {
          width: `${getWidth(columnKey)}px`,
        },
      };
    },
    [getWidth]
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!dragRef.current) return;

      if (dragRef.current.rafId !== null) {
        cancelAnimationFrame(dragRef.current.rafId);
      }

      dragRef.current.rafId = requestAnimationFrame(() => {
        if (!dragRef.current) return;
        const delta = e.clientX - dragRef.current.startX;
        const newWidth = Math.min(
          maxWidth,
          Math.max(minWidth, dragRef.current.startWidth + delta)
        );

        setColumnWidths((prev) => ({
          ...prev,
          [dragRef.current!.columnKey]: newWidth,
        }));
      });
    },
    [minWidth, maxWidth]
  );

  const handleMouseUp = useCallback(() => {
    if (dragRef.current?.rafId != null) {
      cancelAnimationFrame(dragRef.current.rafId);
    }

    // Persist to localStorage
    // We need to read the latest state - use a functional update to capture it
    setColumnWidths((current) => {
      saveWidths(tableId, current);
      return current;
    });

    dragRef.current = null;
    setActiveColumn(null);

    // Reset cursor and selection
    document.body.style.cursor = "";
    document.body.style.userSelect = "";

    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", handleMouseUp);
  }, [tableId, handleMouseMove]);

  const handleMouseDown = useCallback(
    (columnKey: string, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const currentWidth = getWidth(columnKey);

      dragRef.current = {
        startX: e.clientX,
        startWidth: currentWidth,
        columnKey,
        rafId: null,
      };

      setActiveColumn(columnKey);

      // Set cursor globally to prevent flicker
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [getWidth, handleMouseMove, handleMouseUp]
  );

  const handleDoubleClick = useCallback(
    (columnKey: string, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // Reset to default width
      const defaultWidth =
        defaultWidths[columnKey] ?? DEFAULT_FALLBACK_WIDTH;
      const newWidths = { ...columnWidthsRef.current, [columnKey]: defaultWidth };
      setColumnWidths(newWidths);
      saveWidths(tableId, newWidths);
    },
    [defaultWidths, tableId]
  );

  const getResizeHandleProps = useCallback(
    (columnKey: string) => ({
      onMouseDown: (e: React.MouseEvent) => handleMouseDown(columnKey, e),
      onDoubleClick: (e: React.MouseEvent) => handleDoubleClick(columnKey, e),
      isResizing: activeColumn === columnKey,
    }),
    [handleMouseDown, handleDoubleClick, activeColumn]
  );

  const resetWidths = useCallback(() => {
    setColumnWidths({ ...defaultWidths });
    saveWidths(tableId, defaultWidths);
  }, [defaultWidths, tableId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (dragRef.current?.rafId != null) {
        cancelAnimationFrame(dragRef.current.rafId);
      }
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [handleMouseMove, handleMouseUp]);

  return {
    columnWidths,
    getTableProps,
    getHeaderProps,
    getResizeHandleProps,
    isResizing: activeColumn !== null,
    resetWidths,
  };
}
