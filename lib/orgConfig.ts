import type { SupabaseClient } from '@supabase/supabase-js';

export interface OrgConfig {
  currencyCode: string;
  currencySymbol: string;
  waitingPeriodDays: number;
  benefitAmountMinor: number;
  flatCaseFeeMinor: number;
}

const DEFAULTS: OrgConfig = {
  currencyCode: 'KES',
  currencySymbol: 'KSh',
  waitingPeriodDays: 180,
  benefitAmountMinor: 5000000,
  flatCaseFeeMinor: 20000,
};

function asNumber(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function asString(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}

/** Read org_config key/values (stored as raw JSON scalars in seed) into a typed object. */
export async function getOrgConfig(supabase: SupabaseClient): Promise<OrgConfig> {
  const { data, error } = await supabase.from('org_config').select('key, value');
  if (error || !data) return DEFAULTS;
  const map = new Map<string, unknown>(data.map((r: any) => [r.key, r.value]));
  return {
    currencyCode: asString(map.get('currency_code'), DEFAULTS.currencyCode),
    currencySymbol: asString(map.get('currency_symbol'), DEFAULTS.currencySymbol),
    waitingPeriodDays: asNumber(map.get('waiting_period_days'), DEFAULTS.waitingPeriodDays),
    benefitAmountMinor: asNumber(map.get('benefit_amount'), DEFAULTS.benefitAmountMinor),
    flatCaseFeeMinor: asNumber(map.get('flat_case_fee'), DEFAULTS.flatCaseFeeMinor),
  };
}
