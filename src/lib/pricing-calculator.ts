export const OPERATOR_PRICE = { monthlyCents: 6700, yearlyCents: 49000 } as const;

export function monthlyToolCostCents(raw: string): number {
  const amount = Number(raw);
  return Number.isFinite(amount) ? Math.round(Math.max(0, Math.min(100000, amount)) * 100) : 0;
}

export function pricingComparison(tools: Array<{ selected: boolean; cost: string }>, yearly: boolean) {
  const selected = tools.filter((tool) => tool.selected);
  const monthlyToolsCents = selected.reduce((total, tool) => total + monthlyToolCostCents(tool.cost), 0);
  const toolsCents = monthlyToolsCents * (yearly ? 12 : 1);
  const acaCents = yearly ? OPERATOR_PRICE.yearlyCents : OPERATOR_PRICE.monthlyCents;
  return { selectedCount: selected.length, toolsCents, acaCents, differenceCents: toolsCents - acaCents, period: yearly ? 'year' : 'month' };
}
