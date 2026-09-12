/**
 * /api/cases
 * GET  — admin: list cases with optional ?status= and ?search= filters.
 * POST — admin: create a case on behalf of a member (status 'draft').
 */
import { NextRequest } from 'next/server';
import { requireAdmin, handleGuardError } from '@/lib/guard';
import { getOrgConfig } from '@/lib/org';
import { logAudit } from '@/lib/audit';

const CASE_TYPES = ['death', 'medical', 'other'];

export async function GET(request: NextRequest) {
  try {
    const { admin } = await requireAdmin();
    const status = request.nextUrl.searchParams.get('status');
    const search = request.nextUrl.searchParams.get('search');

    let query = admin
      .from('cases')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);
    if (status) query = query.eq('status', status);
    if (search) {
      const like = `%${search}%`;
      query = query.or(`deceased_name.ilike.${like},admin_notes.ilike.${like}`);
    }
    const { data, error } = await query;
    if (error) return Response.json({ error: 'failed to list cases', message: error.message }, { status: 500 });

    const cases = (data ?? []) as Record<string, unknown>[];
    // Attach member names without relying on a guessed FK constraint name.
    const memberIds = Array.from(new Set(cases.map((c) => c.member_id as string)));
    let names: Record<string, string> = {};
    if (memberIds.length > 0) {
      const { data: profiles } = await admin.from('profiles').select('id, full_name').in('id', memberIds);
      names = Object.fromEntries(((profiles ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name]));
    }
    const enriched = cases.map((c) => ({ ...c, member_name: names[c.member_id as string] ?? null }));
    return Response.json({ cases: enriched });
  } catch (e) {
    return handleGuardError(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { profile, admin } = await requireAdmin();
    const body = await request.json().catch(() => ({}));
    const { memberId, case_type, deceased_name, death_date, benefit_amount } = body as {
      memberId?: string;
      case_type?: string;
      deceased_name?: string;
      death_date?: string;
      benefit_amount?: number;
    };

    if (!memberId || !case_type || !deceased_name || !death_date) {
      return Response.json(
        { error: 'memberId, case_type, deceased_name and death_date are required' },
        { status: 400 },
      );
    }
    if (!CASE_TYPES.includes(case_type)) {
      return Response.json({ error: `case_type must be one of: ${CASE_TYPES.join(', ')}` }, { status: 400 });
    }

    const { data: member } = await admin.from('profiles').select('id').eq('id', memberId).single();
    if (!member) return Response.json({ error: 'member not found' }, { status: 404 });

    const org = await getOrgConfig(admin);
    const benefitAmount =
      Number.isInteger(benefit_amount) && (benefit_amount as number) > 0
        ? (benefit_amount as number)
        : org.benefitAmountMinor;

    const { data: newCase, error } = await admin
      .from('cases')
      .insert({
        member_id: memberId,
        case_type,
        deceased_name,
        death_date,
        benefit_amount: benefitAmount,
        status: 'draft',
        created_by_admin: true,
      })
      .select()
      .single();
    if (error || !newCase) {
      return Response.json({ error: 'failed to create case', message: error?.message }, { status: 500 });
    }

    await logAudit(admin, {
      actorId: profile.id,
      action: 'case_created',
      entity: 'case',
      entityId: newCase.id,
      details: { memberId, case_type, created_by_admin: true },
    });

    return Response.json({ case: newCase }, { status: 201 });
  } catch (e) {
    return handleGuardError(e);
  }
}
