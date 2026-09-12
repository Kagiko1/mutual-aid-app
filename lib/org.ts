/** Org configuration reader (org_config key/value table, scoped per org) with sane defaults. */
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

export async function getOrgConfig(admin: SupabaseClient, orgId: string): Promise<OrgConfig> {
  const { data, error } = await admin.from('org_config').select('key, value').eq('org_id', orgId);
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

export interface Organization {
  id: string;
  name: string;
  slug: string;
  currency_code: string;
  invite_code: string;
  plan_id: string | null;
  status: 'trial' | 'active' | 'suspended';
  created_at: string;
}

export async function getOrganization(admin: SupabaseClient, orgId: string): Promise<Organization | null> {
  const { data } = await admin.from('organizations').select('*').eq('id', orgId).single();
  return (data as Organization) ?? null;
}

export async function getOrganizationBySlug(admin: SupabaseClient, slug: string): Promise<Organization | null> {
  const { data } = await admin.from('organizations').select('*').eq('slug', slug.toLowerCase()).single();
  return (data as Organization) ?? null;
}

export async function getOrganizationByInviteCode(
  admin: SupabaseClient,
  inviteCode: string,
): Promise<Organization | null> {
  const { data } = await admin
    .from('organizations')
    .select('*')
    .eq('invite_code', inviteCode.trim().toUpperCase())
    .single();
  return (data as Organization) ?? null;
}

/** Seed the default org_config rows for a brand-new organization. */
export async function seedOrgConfig(
  admin: SupabaseClient,
  orgId: string,
  overrides: { org_name?: string; currency_code?: string; currency_symbol?: string } = {},
): Promise<void> {
  const rows = [
    { org_id: orgId, key: 'org_name', value: overrides.org_name ?? DEFAULTS.orgName },
    { org_id: orgId, key: 'currency_code', value: overrides.currency_code ?? DEFAULTS.currencyCode },
    { org_id: orgId, key: 'currency_symbol', value: overrides.currency_symbol ?? DEFAULTS.currencySymbol },
    { org_id: orgId, key: 'waiting_period_days', value: DEFAULTS.waitingPeriodDays },
    { org_id: orgId, key: 'max_dependents', value: DEFAULTS.maxDependents },
    { org_id: orgId, key: 'benefit_amount', value: DEFAULTS.benefitAmountMinor },
    { org_id: orgId, key: 'penalty_amount', value: DEFAULTS.penaltyAmountMinor },
    { org_id: orgId, key: 'flat_case_fee', value: DEFAULTS.flatCaseFeeMinor },
    { org_id: orgId, key: 'invoicing_strategy', value: DEFAULTS.invoicingStrategy },
    { org_id: orgId, key: 'annual_fee', value: DEFAULTS.annualFeeMinor },
  ];
  const { error } = await admin.from('org_config').upsert(rows, { onConflict: 'org_id,key' });
  if (error) throw new Error(`seedOrgConfig failed: ${error.message}`);
}
