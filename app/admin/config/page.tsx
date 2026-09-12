import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/admin/guard';
import { getOrgConfig } from '@/lib/admin/config';
import { toMinor } from '@/lib/money';
import { Card, PageHeader, inputCls, btnPrimary } from '@/components/admin/ui';
import TotpSetup from '@/components/admin/TotpSetup';

export default async function ConfigPage() {
  const cfg = await getOrgConfig();

  async function saveConfig(formData: FormData) {
    'use server';
    await requireAdmin();
    const supabase = createClient();

    const num = (k: string, fallback: number) => {
      const v = Number(String(formData.get(k) || ''));
      return Number.isFinite(v) ? v : fallback;
    };
    const entries: [string, unknown][] = [
      ['currency_code', String(formData.get('currency_code') || 'KES').trim().toUpperCase()],
      ['currency_symbol', String(formData.get('currency_symbol') || 'KSh').trim()],
      ['waiting_period_days', Math.round(num('waiting_period_days', cfg.waiting_period_days))],
      ['max_dependents', Math.round(num('max_dependents', cfg.max_dependents))],
      ['benefit_amount', toMinor(num('benefit_amount', cfg.benefit_amount / 100))],
      ['penalty_amount', toMinor(num('penalty_amount', cfg.penalty_amount / 100))],
      ['flat_case_fee', toMinor(num('flat_case_fee', cfg.flat_case_fee / 100))],
      ['invoicing_strategy', String(formData.get('invoicing_strategy') || 'flat')],
      ['annual_fee', toMinor(num('annual_fee', cfg.annual_fee / 100))],
    ];
    for (const [key, value] of entries) {
      await supabase.from('org_config').upsert({ key, value });
    }
    revalidatePath('/admin/config');
    revalidatePath('/admin');
  }

  return (
    <div>
      <PageHeader title="Configuration" subtitle="Organisation-wide settings. Currency changes refresh across the app immediately." />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card title="Organisation settings">
          <form action={saveConfig} className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">Currency code</label>
              <input name="currency_code" defaultValue={cfg.currency_code} className={inputCls} maxLength={6} />
              <p className="mt-1 text-xs text-slate-400">Live-refreshes across the app.</p>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">Currency symbol</label>
              <input name="currency_symbol" defaultValue={cfg.currency_symbol} className={inputCls} maxLength={6} />
              <p className="mt-1 text-xs text-slate-400">Live-refreshes across the app.</p>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">Waiting period (days)</label>
              <input name="waiting_period_days" type="number" min={0} defaultValue={cfg.waiting_period_days} className={inputCls} />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">Max dependents</label>
              <input name="max_dependents" type="number" min={0} defaultValue={cfg.max_dependents} className={inputCls} />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">Benefit amount (major)</label>
              <input name="benefit_amount" type="number" min={0} step="0.01" defaultValue={(cfg.benefit_amount / 100).toFixed(2)} className={inputCls} />
              <p className="mt-1 text-xs text-slate-400">Stored in minor units.</p>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">Penalty amount (major)</label>
              <input name="penalty_amount" type="number" min={0} step="0.01" defaultValue={(cfg.penalty_amount / 100).toFixed(2)} className={inputCls} />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">Flat case fee (major)</label>
              <input name="flat_case_fee" type="number" min={0} step="0.01" defaultValue={(cfg.flat_case_fee / 100).toFixed(2)} className={inputCls} />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">Annual fee (major)</label>
              <input name="annual_fee" type="number" min={0} step="0.01" defaultValue={(cfg.annual_fee / 100).toFixed(2)} className={inputCls} />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1.5 block text-xs font-medium text-slate-600">Invoicing strategy</label>
              <select name="invoicing_strategy" defaultValue={cfg.invoicing_strategy} className={inputCls}>
                <option value="flat">flat</option>
                <option value="proportional">proportional</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <button type="submit" className={btnPrimary}>Save configuration</button>
            </div>
          </form>
        </Card>

        <Card title="Two-factor authentication (TOTP)">
          <TotpSetup />
        </Card>
      </div>
    </div>
  );
}
