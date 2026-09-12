/**
 * /api/super/orgs — SaaS operator organization management.
 * GET   — list orgs with plan name, member count and status.
 * PATCH — { orgId, status } sets trial/active/suspended, or
 *         { orgId, planId } moves the org to a different plan (upsert subscription).
 */
import { NextRequest } from 'next/server';
import { requireSuperAdmin, handleGuardError } from '@/lib/guard';

const ORG_STATUSES = ['trial', 'active', 'suspended'];

export async function GET() {
  try {
    const { admin } = await requireSuperAdmin();

    const { data: orgs, error } = await admin
      .from('organizations')
      .select('id, name, slug, currency_code, invite_code, status, created_at')
      .order('created_at', { ascending: false });
    if (error) return Response.json({ error: 'failed to list organizations', message: error.message }, { status: 500 });

    const { data: subs } = await admin
      .from('subscriptions')
      .select('org_id, status, plans(name)');
    const subByOrg = new Map(
      ((subs ?? []) as { org_id: string; status: string; plans: { name: string }[] | null }[]).map((s) => [
        s.org_id,
        { planName: s.plans?.[0]?.name ?? null, subscriptionStatus: s.status },
      ]),
    );

    const { data: profiles } = await admin.from('profiles').select('org_id');
    const membersByOrg = new Map<string, number>();
    for (const p of (profiles ?? []) as { org_id: string | null }[]) {
      if (!p.org_id) continue;
      membersByOrg.set(p.org_id, (membersByOrg.get(p.org_id) ?? 0) + 1);
    }

    const rows = ((orgs ?? []) as Record<string, unknown>[]).map((o) => {
      const sub = subByOrg.get(o.id as string);
      return {
        ...o,
        planName: sub?.planName ?? null,
        subscriptionStatus: sub?.subscriptionStatus ?? null,
        memberCount: membersByOrg.get(o.id as string) ?? 0,
      };
    });

    return Response.json({ orgs: rows });
  } catch (e) {
    return handleGuardError(e);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { admin } = await requireSuperAdmin();
    const body = await request.json().catch(() => ({}));
    const { orgId, status, planId } = body as { orgId?: string; status?: string; planId?: string };
    if (!orgId) return Response.json({ error: 'orgId is required' }, { status: 400 });

    const { data: org } = await admin.from('organizations').select('id').eq('id', orgId).single();
    if (!org) return Response.json({ error: 'organization not found' }, { status: 404 });

    if (status !== undefined) {
      if (!ORG_STATUSES.includes(status)) {
        return Response.json({ error: `status must be one of: ${ORG_STATUSES.join(', ')}` }, { status: 400 });
      }
      const { error } = await admin.from('organizations').update({ status }).eq('id', orgId);
      if (error) return Response.json({ error: 'failed to update status', message: error.message }, { status: 500 });
    }

    if (planId !== undefined) {
      const { data: plan } = await admin.from('plans').select('id').eq('id', planId).single();
      if (!plan) return Response.json({ error: 'plan not found' }, { status: 404 });
      const { error } = await admin
        .from('subscriptions')
        .upsert({ org_id: orgId, plan_id: planId, status: 'active' }, { onConflict: 'org_id' });
      if (error) return Response.json({ error: 'failed to update plan', message: error.message }, { status: 500 });
    }

    return Response.json({ ok: true });
  } catch (e) {
    return handleGuardError(e);
  }
}
