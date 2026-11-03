import { useCallback, useMemo, useState, type ReactNode } from "react";
import { displayLocation } from "@/lib/signals";
import { EMPLOYEE_BAND_OPTIONS } from "@/hooks/usePublicSignalAutoEnroll";

/**
 * Column model shared by the three signal tables.
 *
 * Every column — including the ones that were hardcoded before — is described
 * here so the Columns picker can hide any of them, and so the firmographics
 * render identically wherever they appear.
 */
export interface SignalColumn<Row> {
  id: string;
  label: string;
  /** Shown unless the user says otherwise. Firmographic detail defaults off. */
  defaultVisible: boolean;
  /** Sort key the RPC understands; omitted for columns the server can't sort. */
  sortKey?: string;
  thClassName?: string;
  tdClassName?: string;
  cell: (row: Row) => ReactNode;
}

/** The firmographic shape every signal RPC now returns alongside its own rows. */
export interface FirmographicFields {
  company_employee_count?: number | null;
  company_employee_range?: string | null;
  company_employee_band?: string | null;
  company_revenue_range?: string | null;
  company_industry?: string | null;
  company_linkedin_industries?: string[] | null;
  company_naics_titles?: string[] | null;
  company_country?: string | null;
}

/**
 * MoltSets' industry vocabulary, which is what both branches store: the public
 * library from search_companies, the custom one from the same fields on the
 * agent's contact metadata. Fixed rather than derived from the current page, so
 * a filter can select an industry that only appears on page 3.
 */
export const INDUSTRY_OPTIONS: Array<{ value: string; label: string }> = [
  "Professional and Business Services",
  "Information Technology",
  "Manufacturing",
  "Retail",
  "Health and Pharmaceuticals",
  "Creative Arts and Entertainment",
  "Construction",
  "Marketing & Advertising",
  "Finance and Banking",
  "Tourism and Hospitality",
  "Non-Profit and Social Services",
  "Food and Beverage",
  "Real Estate",
  "Education",
  "Transportation and Logistics",
  "Media and Publishing",
  "Energy",
  "Automotive",
  "Government and Public Administration",
  "Telecommunications",
  "Agriculture",
  "Utilities",
  "Corporate Services",
  "Insurance",
].map((value) => ({ value, label: value }));

const EMPLOYEE_BAND_LABELS = new Map(EMPLOYEE_BAND_OPTIONS.map((o) => [o.value, o.label]));

/** "1,204" — the exact headcount is the point; the band is the fallback. */
function formatHeadcount(count?: number | null): string | null {
  return typeof count === "number" && count > 0 ? count.toLocaleString() : null;
}

const EMPTY = <span className="text-muted-foreground/50">—</span>;

/**
 * Size / revenue / industry / country, rendered the same in all three tables.
 * Size and revenue lead the set because they are what people qualify on; the
 * finer-grained labels (LinkedIn industry, NAICS) stay hidden until asked for.
 */
export function firmographicColumns<Row extends FirmographicFields>(): Array<SignalColumn<Row>> {
  return [
    {
      id: "size",
      label: "Size",
      defaultVisible: true,
      sortKey: "employees",
      tdClassName: "whitespace-nowrap",
      cell: (row) => {
        const exact = formatHeadcount(row.company_employee_count);
        const band = row.company_employee_band
          ? EMPLOYEE_BAND_LABELS.get(row.company_employee_band) ?? row.company_employee_band
          : row.company_employee_range;
        if (!exact && !band) return EMPTY;
        return (
          <>
            <p className="font-medium tabular-nums">{exact ?? band}</p>
            {exact && band && <p className="text-xs text-muted-foreground">{band} employees</p>}
          </>
        );
      },
    },
    {
      id: "revenue",
      label: "Revenue",
      defaultVisible: true,
      sortKey: "revenue",
      tdClassName: "whitespace-nowrap",
      cell: (row) => (row.company_revenue_range ? <span>{row.company_revenue_range}</span> : EMPTY),
    },
    {
      id: "industry",
      label: "Industry",
      defaultVisible: true,
      sortKey: "industry",
      tdClassName: "max-w-[200px]",
      cell: (row) => {
        const linkedin = row.company_linkedin_industries?.filter(Boolean) ?? [];
        if (!row.company_industry && !linkedin.length) return EMPTY;
        return (
          <>
            <p className="line-clamp-1" title={row.company_industry || undefined}>
              {row.company_industry || linkedin[0]}
            </p>
            {row.company_industry && linkedin.length > 0 && (
              <p className="line-clamp-1 text-xs text-muted-foreground" title={linkedin.join(" · ")}>
                {linkedin.join(" · ")}
              </p>
            )}
          </>
        );
      },
    },
    {
      id: "country",
      label: "Country",
      defaultVisible: false,
      sortKey: "country",
      tdClassName: "whitespace-nowrap",
      cell: (row) =>
        row.company_country ? <span>{displayLocation(row.company_country)}</span> : EMPTY,
    },
    {
      id: "naics",
      label: "NAICS",
      defaultVisible: false,
      tdClassName: "max-w-[220px]",
      cell: (row) => {
        const titles = row.company_naics_titles?.filter(Boolean) ?? [];
        if (!titles.length) return EMPTY;
        return (
          <span className="line-clamp-2 text-xs text-muted-foreground" title={titles.join(" · ")}>
            {titles.join(" · ")}
          </span>
        );
      },
    },
  ];
}

/**
 * Which columns a table shows, remembered per table in localStorage.
 *
 * Stores the full visible set (not a diff against the defaults) so that adding
 * a column later doesn't silently turn it on for people who have customized
 * their view — new columns appear only after a Reset.
 */
export function useColumnVisibility<Row>(storageKey: string, columns: Array<SignalColumn<Row>>) {
  const defaults = useMemo(
    () => columns.filter((column) => column.defaultVisible).map((column) => column.id),
    [columns],
  );

  const [visible, setVisible] = useState<string[]>(() => {
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (!stored) return defaults;
      const parsed = JSON.parse(stored) as unknown;
      if (!Array.isArray(parsed)) return defaults;
      const known = parsed.filter((id): id is string =>
        typeof id === "string" && columns.some((column) => column.id === id));
      return known.length ? known : defaults;
    } catch {
      return defaults;
    }
  });

  const persist = useCallback((next: string[]) => {
    setVisible(next);
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // A blocked localStorage costs persistence, not the feature.
    }
  }, [storageKey]);

  const toggle = useCallback((id: string, checked: boolean) => {
    persist(checked ? [...visible.filter((v) => v !== id), id] : visible.filter((v) => v !== id));
  }, [persist, visible]);

  const reset = useCallback(() => {
    persist(defaults);
  }, [defaults, persist]);

  const visibleSet = useMemo(() => new Set(visible), [visible]);
  // Column order stays the table's own, never the order they were toggled in.
  const visibleColumns = useMemo(
    () => columns.filter((column) => visibleSet.has(column.id)),
    [columns, visibleSet],
  );

  return { visibleColumns, visibleIds: visibleSet, toggle, reset, isDefault: visible.length === defaults.length && defaults.every((id) => visibleSet.has(id)) };
}
