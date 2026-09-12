/** Org configuration reader (org_config key/value table) with sane defaults. */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface OrgConfig {
  orgName: string;
  currencyCode: string;
  currencySymbol: string;
  waitingPeriodDays: number;
  maxDependents: number;
  benefitAmountMinor: number;
  penaltyAmountMinor: number;
  flatCaseFeeMinor: number;
  invoicingStrategy: 'flat' | 'proportional';
  annualFeeMinor: number;
}

const DEFAULTS: OrgConfig = {
  orgName: 'Umoja Welfare Association',
  currencyCode: 'KES',
  currencySymbol: 'KSh',
  waitingPeriodDays: 180,
  maxDependents: 10,
  benefitAmountMinor: 5000000,
  penaltyAmountMinor: 50000,
  flatCaseFeeMinor: 20000,
  invoicingStrategy: 'flat',
  annualFeeMinor: 120000,
};

export async function getOrgConfig(admin: SupabaseClient): Promise<OrgConfig> {
  const { data, error } = await admin.from('org_config').select('key, value');
  if (error) {
    console.error('[org] failed to load org_config, using defaults:', error.message);
    return { ...DEFAULTS };
  }
  const map = new Map<string, unknown>((data ?? []).map((r: { key: string; value: unknown }) => [r.key, r.value]));

  const num = (key: string, fallback: number): number => {
    const v = map.get(key);
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
    return fallback;
  };
  const str = (key: string, fallback: string): string => {
    const v = map.get(key);
    return typeof v === 'string' ? v : fallback;
  };

  const strategy = str('invoicing_strategy', DEFAULTS.invoicingStrategy);
  return {
    orgName: str('org_name', DEFAULTS.orgName),
    currencyCode: str('currency_code', DEFAULTS.currencyCode),
    currencySymbol: str('currency_symbol', DEFAULTS.currencySymbol),
    waitingPeriodDays: num('waiting_period_days', DEFAULTS.waitingPeriodDays),
    maxDependents: num('max_dependents', DEFAULTS.maxDependents),
    benefitAmountMinor: num('benefit_amount', DEFAULTS.benefitAmountMinor),
    penaltyAmountMinor: num('penalty_amount', DEFAULTS.penaltyAmountMinor),
    flatCaseFeeMinor: num('flat_case_fee', DEFAULTS.flatCaseFeeMinor),
    invoicingStrategy: strategy === 'proportional' ? 'proportional' : 'flat',
    annualFeeMinor: num('annual_fee', DEFAULTS.annualFeeMinor),
  };
}
