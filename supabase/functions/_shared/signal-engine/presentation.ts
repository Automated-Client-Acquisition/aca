export interface SignalPresentation {
  title: string;
  detail: string;
  whyItMatters: string | null;
  amountLabel: string | null;
  amountUsd: number | null;
  details: Record<string, unknown>;
}

type Role = { title?: unknown; location?: unknown; department?: unknown };

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function nonNegativeNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function compactUsd(value: number): string {
  const scale = value >= 1_000_000_000 ? 1_000_000_000 : value >= 1_000_000 ? 1_000_000 : value >= 1_000 ? 1_000 : 1;
  const suffix = scale === 1_000_000_000 ? 'B' : scale === 1_000_000 ? 'M' : scale === 1_000 ? 'K' : '';
  const scaled = value / scale;
  return `$${scaled.toLocaleString('en-US', { maximumFractionDigits: scaled >= 100 ? 0 : 1 })}${suffix}`;
}

function defaultWhy(eventType: string): string | null {
  if (eventType === 'hiring') return 'Active hiring indicates budget, growth, and near-term operational needs.';
  if (eventType === 'funding') return 'Fresh financing signals available budget and a near-term window for new vendors and growth initiatives.';
  if (eventType === 'acquisition') return 'Acquisition activity creates integration, consolidation, and change-management needs with executive visibility.';
  if (eventType === 'leadership_change') return 'A leadership change often resets priorities, vendors, and operating plans.';
  if (eventType === 'growth') return 'Verified growth creates new capacity, tooling, and go-to-market needs.';
  return null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.map(text).filter((item): item is string => !!item))]
    : [];
}

function roles(value: unknown): Array<{ title: string; location: string | null; department: string | null }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return [];
    const role = raw as Role;
    const title = text(role.title);
    return title ? [{ title, location: text(role.location), department: text(role.department) }] : [];
  });
}

export function buildSignalPresentation(
  companyName: string,
  eventType: string,
  payload: Record<string, unknown>,
): SignalPresentation {
  const explicitTitle = text(payload.headline) ?? text(payload.title);
  const explicitDetail = text(payload.summary) ?? text(payload.detail);
  if (explicitTitle && explicitDetail) {
    return {
      title: explicitTitle,
      detail: explicitDetail,
      whyItMatters: text(payload.why_it_matters) ?? defaultWhy(eventType),
      amountLabel: text(payload.amount_label),
      amountUsd: nonNegativeNumber(payload.amount_usd),
      details: payload,
    };
  }

  if (eventType === 'hiring') {
    const openRoles = roles(payload.roles);
    const count = positiveInteger(payload.new_role_count) ?? openRoles.length;
    const totalOpenRoles = positiveInteger(payload.total_open_roles);
    const roleTitles = [...new Set(openRoles.map((role) => role.title))];
    const locations = [...new Set(openRoles.map((role) => role.location).filter((value): value is string => !!value))];
    const payloadDepartments = strings(payload.departments);
    const departments = payloadDepartments.length
      ? payloadDepartments
      : [...new Set(openRoles.map((role) => role.department).filter((value): value is string => !!value))];
    const title = explicitTitle ?? `${companyName} opened ${count} new ${count === 1 ? 'role' : 'roles'}`;
    const roleSummary = openRoles.slice(0, 3).map((role) =>
      role.location ? `${role.title} (${role.location})` : role.title
    ).join('; ');
    const detail = explicitDetail ?? [
      `${title}.`,
      roleSummary ? `Roles: ${roleSummary}.` : null,
      totalOpenRoles != null ? `${totalOpenRoles} total open roles.` : null,
    ].filter(Boolean).join(' ');
    return {
      title,
      detail,
      whyItMatters: defaultWhy(eventType),
      amountLabel: null,
      amountUsd: null,
      details: {
        new_role_count: count,
        total_open_roles: totalOpenRoles,
        role_titles: roleTitles,
        locations,
        departments,
        roles: openRoles,
      },
    };
  }

  if (eventType === 'funding') {
    const amountUsd = nonNegativeNumber(payload.total_amount_sold)
      ?? nonNegativeNumber(payload.amount_usd)
      ?? nonNegativeNumber(payload.total_offering_amount);
    const amountLabel = amountUsd == null ? null : compactUsd(amountUsd);
    const formType = text(payload.form_type);
    const investorCount = positiveInteger(payload.investor_count);
    const title = explicitTitle ?? (amountLabel
      ? `${companyName} disclosed ${amountLabel} in funding`
      : `${companyName} disclosed a funding event`);
    const detail = explicitDetail ?? [
      `${title}.`,
      formType ? `${formType} filing.` : null,
      investorCount != null ? `${investorCount} reported ${investorCount === 1 ? 'investor' : 'investors'}.` : null,
    ].filter(Boolean).join(' ');
    return {
      title,
      detail,
      whyItMatters: defaultWhy(eventType),
      amountLabel,
      amountUsd,
      details: {
        ...payload,
        amount_label: amountLabel,
        amount_usd: amountUsd,
      },
    };
  }

  if (eventType === 'acquisition') {
    const filingItems = strings(payload.items);
    const formType = text(payload.form_type) ?? 'SEC filing';
    const title = explicitTitle ?? `${companyName} filed an acquisition-related ${formType}`;
    const detail = explicitDetail ?? [
      `${title}.`,
      filingItems.length ? `Filing items: ${filingItems.slice(0, 4).join('; ')}.` : null,
    ].filter(Boolean).join(' ');
    return {
      title,
      detail,
      whyItMatters: defaultWhy(eventType),
      amountLabel: null,
      amountUsd: null,
      details: { ...payload, filing_items: filingItems },
    };
  }

  const label = eventType.replaceAll('_', ' ');
  const title = explicitTitle ?? `${companyName}: ${label}`;
  return {
    title,
    detail: explicitDetail ?? title,
    whyItMatters: text(payload.why_it_matters) ?? defaultWhy(eventType),
    amountLabel: text(payload.amount_label),
    amountUsd: nonNegativeNumber(payload.amount_usd),
    details: payload,
  };
}
