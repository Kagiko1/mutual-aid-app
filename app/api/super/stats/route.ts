/**
 * GET /api/super/stats — SaaS operator overview.
 * Returns { orgs, members, mrrUsdMinor, plans: [{ name, orgs }] }.
 * MRR sums active/trial subscription plan prices converted to USD minor units.
 */
import { requireSuperAdmin, handleGuardError } from '@/lib/guard';
import { convertMinor } from '@/lib/currency';

export async function GET() {
  try {
    const { admin } = await requireSuperAdmin();

    const [{ count: orgCount }, { count: memberCount }] = await Promise.all([
      admin.from('organizations').select('id', { count: 'exact', head: true }),
      admin.from('profiles').select('id', { count: 'exact', head: true }),
    ]);

    // USD-anchored FX map: currency code → units per 1 USD.
    const { data: fxRows } = await admin.from('fx_rates').select('quote_currency, rate').eq('base_currency', 'USD');
    const usdRates: Record<string, number> = { USD: 1 };
    for (const r of (fxRows ?? []) as { quote_currency: string; rate: number | string }[]) {
      usdRates[r.quote_currency.toUpperCase()] = Number(r.rate);
    }

    const { data: subs } = await admin
      .from('subscriptions')
      .select('plan_id, plans(price_minor, currency_code)')
      .in('status', ['active', 'trial']);

    let mrrUsdMinor = 0;
    const orgsByPlan = new Map<string, number>();
    for (const s of (subs ?? []) as { plan_id: string; plans: { price_minor: number; currency_code: string }[] | null }[]) {
      const plan = s.plans?.[0];
      if (!plan) continue;
      try {
        mrrUsdMinor += convertMinor(plan.price_minor, plan.currency_code, 'USD', usdRates);
      } catch {
        // Missing FX rate — skip this plan's contribution.
      }
      orgsByPlan.set(s.plan_id, (orgsByPlan.get(s.plan_id) ?? 0) + 1);
    }

    const { data: plans } = await admin.from('plans').select('id, name').order('price_minor');
    const planStats = ((plans ?? []) as { id: string; name: string }[]).map((p) => ({
      name: p.name,
      orgs: orgsByPlan.get(p.id) ?? 0,
    }));

    return Response.json({
      orgs: orgCount ?? 0,
      members: memberCount ?? 0,
      mrrUsdMinor,
      plans: planStats,
    });
  } catch (e) {
    return handleGuardError(e);
  }
}
