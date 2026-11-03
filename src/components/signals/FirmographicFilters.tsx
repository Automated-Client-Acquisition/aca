import { BandPicker } from "@/components/signals/BandPicker";
import { INDUSTRY_OPTIONS } from "@/components/signals/signal-columns";
import { EMPLOYEE_BAND_OPTIONS, REVENUE_BAND_OPTIONS } from "@/hooks/usePublicSignalAutoEnroll";

export interface FirmographicFilterState {
  employeeBands: string[];
  revenueBands: string[];
  industries: string[];
}

export const EMPTY_FIRMOGRAPHIC_FILTERS: FirmographicFilterState = {
  employeeBands: [],
  revenueBands: [],
  industries: [],
};

/** Arrays the RPCs treat as "no filter" must be NULL, not []. */
export function firmographicParams(state: FirmographicFilterState) {
  return {
    p_employee_bands: state.employeeBands.length ? state.employeeBands : null,
    p_revenue_bands: state.revenueBands.length ? state.revenueBands : null,
    p_industries: state.industries.length ? state.industries : null,
  };
}

/**
 * Company size / revenue / industry filters for the signal tables.
 *
 * Same vocabularies as the auto-add rule dialog, and the same convention: a
 * company we haven't enriched fails a filter that's been set, rather than
 * slipping through it.
 */
export function FirmographicFilters({
  value,
  onChange,
}: {
  value: FirmographicFilterState;
  onChange: (next: FirmographicFilterState) => void;
}) {
  return (
    <>
      <BandPicker
        options={EMPLOYEE_BAND_OPTIONS}
        selected={value.employeeBands}
        onChange={(employeeBands) => onChange({ ...value, employeeBands })}
        emptyLabel="Any size"
        unit="size"
        searchPlaceholder="Search sizes…"
        className="w-32"
        highlightWhenSelected
      />
      <BandPicker
        options={REVENUE_BAND_OPTIONS}
        selected={value.revenueBands}
        onChange={(revenueBands) => onChange({ ...value, revenueBands })}
        emptyLabel="Any revenue"
        unit="band"
        searchPlaceholder="Search revenue…"
        className="w-36"
        highlightWhenSelected
      />
      <BandPicker
        options={INDUSTRY_OPTIONS}
        selected={value.industries}
        onChange={(industries) => onChange({ ...value, industries })}
        emptyLabel="Any industry"
        unit="industry"
        searchPlaceholder="Search industries…"
        className="w-36"
        contentClassName="w-[280px]"
        highlightWhenSelected
      />
    </>
  );
}
