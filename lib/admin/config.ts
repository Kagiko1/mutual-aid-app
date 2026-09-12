import { createAdminClient, createClient } from '@/lib/supabase/server';
import { formatMoney } from '@/lib/money';

export interface OrgConfig {
  currency_code: string;
  currency_symbol: string;
  waiting_period_days: number;
  max_dependents: number;
  /** minor units */
  benefit_amount: number;
  /** minor units */
  penalty_amount: number;
  /** minor units */
  flat_case_fee: number;
  invoicing_strategy: 'flat' | 'proportional';
  /** minor units */
  annual_fee: number;
}

export const CONFIG_DEFAULTS: OrgConfig = {
  currency_code: 'KES',
  currency_symbol: 'KSh',
  waiting_period_days: 30,
  max_dependents: 6,
  benefit_amount: 10000000,
  penalty_amount: 0,
  flat_case_fee: 50000,
  invoicing_strategy: 'flat',
  annual_fee: 120000,
};

/**
 * Read org_config key/value rows (jsonb scalars) into a typed object with defaults.
 * Pass an orgId explicitly, or it resolves from the current session's profile.
 */
export async function getOrgConfig(orgId?: string): Promise<OrgConfig> {
  try {
    const admin = createAdminClient();
    let id = orgId;
    if (!id) {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const { data: p } = await admin.from('profiles').select('org_id').eq('id', user.id).single();
        id = (p as { org_id?: string } | null)?.org_id;
      }
    }
    const { data } = await admin.from('org_config').select('key, value').eq('org_id', id ?? '');
    const cfg: OrgConfig = { ...CONFIG_DEFAULTS };
    for (const row of ((data ?? []) as { key: string; value: unknown }[])) {
      if (row.key in cfg) {
        (cfg as unknown as Record<string, unknown>)[row.key] = row.value;
      }
    }
    return cfg;
  } catch {
    return { ...CONFIG_DEFAULTS };
  }
}

/** Format a minor-units amount in the org's currency. */
export function money(amountMinor: number | null | undefined, cfg: OrgConfig): string {
  return formatMoney(Number(amountMinor ?? 0), cfg.currency_code);
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' });
}

export function fmtDay(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-KE', { dateStyle: 'medium' });
}
