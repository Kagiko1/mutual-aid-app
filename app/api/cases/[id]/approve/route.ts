/**
 * POST /api/cases/[id]/approve
 * Body: { signatureType: 'typed'|'canvas', signatureData: string, deceasedMemberId?: string }
 *
 * Admin-only, TOTP-gated. Case must be 'reviewed' or 'pending_review'.
 *
 * Steps:
 *  1. Validate beneficiary percentages sum to 100.
 *  2. Double-payout check: if the deceased is both a member and someone's
 *     dependent (matched by national_id), open a paired draft case linked
 *     both ways via paired_case_id.
 *  3. Record the approving admin's e-signature.
 *  4. Mark the case approved; issue a voucher (VCH-YYYY-######).
 *  5. Invoice all active members (excluding the deceased member) per the org
 *     invoicing strategy; route any surplus to the reserve ledger + Reserve Fund.
 */
import { NextRequest } from 'next/server';
import { requireAdmin, checkTotp, handleGuardError } from '@/lib/guard';
import { getOrgConfig } from '@/lib/org';
import { validatePercentages } from '@/lib/engines/beneficiarySplit';
import { detectDoublePayout } from '@/lib/engines/doublePayout';
import { computeCaseInvoices } from '@/lib/engines/invoicing';
import { logAudit } from '@/lib/audit';
import { notifyMember } from '@/lib/notify';
import { formatMoney } from '@/lib/money';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { profile, admin } = await requireAdmin();
    checkTotp(request, profile);

    const body = await request.json().catch(() => ({}));
    const { signatureType, signatureData, deceasedMemberId } = body as {
      signatureType?: string;
      signatureData?: string;
      deceasedMemberId?: string;
    };
    if (!['typed', 'canvas'].includes(signatureType ?? '')) {
      return Response.json({ error: "signatureType must be 'typed' or 'canvas'" }, { status: 400 });
    }
    if (!signatureData) {
      return Response.json({ error: 'signatureData is required' }, { status: 400 });
    }

    const { data: theCase } = await admin.from('cases').select('*').eq('id', params.id).single();
    if (!theCase) return Response.json({ error: 'case not found' }, { status: 404 });
    if (!['reviewed', 'pending_review'].includes(theCase.status)) {
      return Response.json(
        { error: 'invalid_case_status', message: `Case is ${theCase.status}; only reviewed/pending_review cases can be approved` },
        { status: 400 },
      );
    }

    const { data: member } = await admin.from('profiles').select('*').eq('id', theCase.member_id).single();
    if (!member) return Response.json({ error: 'case member not found' }, { status: 404 });

    const { data: beneficiaries } = await admin
      .from('beneficiaries')
      .select('*')
      .eq('member_id', theCase.member_id);
    const shares = ((beneficiaries ?? []) as { id: string; percentage: number | string }[]).map((b) => ({
      id: b.id,
      percentage: Number(b.percentage),
    }));
    try {
      validatePercentages(shares);
    } catch (e) {
      return Response.json(
        { error: 'invalid_beneficiaries', message: e instanceof Error ? e.message : 'Invalid beneficiary split' },
        { status: 400 },
      );
    }

    const org = await getOrgConfig(admin);
    const benefitAmount: number = theCase.benefit_amount;

    // ---- Double-payout detection ----
    // The deceased member is identified via body.deceasedMemberId, else the
    // case's deceased_member_id. The engine then matches by national_id across
    // all dependents.
    let deceasedProfile: { id: string; national_id: string | null; full_name: string } | null = null;
    const deceasedId = deceasedMemberId ?? theCase.deceased_member_id ?? null;
    if (deceasedId) {
      const { data } = await admin.from('profiles').select('id, national_id, full_name').eq('id', deceasedId).single();
      deceasedProfile = data;
    }
    let pairedCaseId: string | null = null;
    if (deceasedProfile?.national_id) {
      const { data: allDependents } = await admin.from('dependents').select('id, member_id, full_name, national_id');
      const { data: depMembers } = await admin
        .from('profiles')
        .select('id, full_name')
        .in('id', ((allDependents ?? []) as { member_id: string }[]).map((d) => d.member_id));
      const memberNames = Object.fromEntries(
        ((depMembers ?? []) as { id: string; full_name: string }[]).map((m) => [m.id, m.full_name]),
      );
      const result = detectDoublePayout(
        { id: deceasedProfile.id, nationalId: deceasedProfile.national_id, fullName: deceasedProfile.full_name },
        ((allDependents ?? []) as { id: string; member_id: string; full_name: string; national_id: string | null }[]).map(
          (d) => ({
            id: d.id,
            memberId: d.member_id,
            memberName: memberNames[d.member_id] ?? d.member_id,
            fullName: d.full_name,
            nationalId: d.national_id,
          }),
        ),
      );
      if (result.isDoublePayout && result.matchedDependent) {
        // Open a paired draft case under the dependent's member, linked both ways.
        const { data: paired } = await admin
          .from('cases')
          .insert({
            member_id: result.matchedDependent.memberId,
            case_type: theCase.case_type,
            deceased_name: theCase.deceased_name,
            death_date: theCase.death_date,
            benefit_amount: benefitAmount,
            status: 'draft',
            created_by_admin: true,
            admin_notes: `DOUBLE-PAYOUT pair of case ${theCase.id}: ${result.reason}`,
            paired_case_id: theCase.id,
          })
          .select()
          .single();
        if (paired) {
          pairedCaseId = paired.id;
          await admin.from('cases').update({ paired_case_id: paired.id }).eq('id', theCase.id);
          await logAudit(admin, {
            actorId: profile.id,
            action: 'double_payout_paired_case',
            entity: 'case',
            entityId: paired.id,
            details: { originalCaseId: theCase.id, reason: result.reason },
          });
        }
      }
    }

    // ---- Admin e-signature on approval ----
    await admin.from('signatures').insert({
      member_id: profile.id,
      case_id: theCase.id,
      signature_type: signatureType,
      signature_data: signatureData,
    });

    const now = new Date().toISOString();
    await admin.from('cases').update({ status: 'approved', approved_at: now }).eq('id', theCase.id);

    // ---- Voucher ----
    const year = new Date().getFullYear();
    const { count } = await admin.from('vouchers').select('id', { count: 'exact', head: true });
    const voucherNo = `VCH-${year}-${String((count ?? 0) + 1).padStart(6, '0')}`;
    const { data: voucher, error: voucherErr } = await admin
      .from('vouchers')
      .insert({
        case_id: theCase.id,
        voucher_no: voucherNo,
        amount: benefitAmount,
        currency_code: org.currencyCode,
        currency_symbol: org.currencySymbol,
        issued_by: profile.id,
      })
      .select()
      .single();
    if (voucherErr || !voucher) {
      return Response.json({ error: 'failed to issue voucher', message: voucherErr?.message }, { status: 500 });
    }

    // ---- Invoicing ----
    const { data: activeMembers } = await admin.from('profiles').select('id').eq('role', 'member').eq('status', 'active');
    const deceasedIds = new Set([deceasedProfile?.id].filter(Boolean) as string[]);
    const memberIds = ((activeMembers ?? []) as { id: string }[])
      .map((m) => m.id)
      .filter((id) => !deceasedIds.has(id));
    if (memberIds.length === 0) {
      return Response.json({ error: 'no active members to invoice' }, { status: 400 });
    }
    const invoicing = computeCaseInvoices({
      strategy: org.invoicingStrategy,
      flatFeeMinor: org.flatCaseFeeMinor,
      benefitAmountMinor: benefitAmount,
      memberIds,
    });
    const dueDate = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    await admin.from('invoices').insert(
      invoicing.invoices.map((inv) => ({
        member_id: inv.memberId,
        case_id: theCase.id,
        amount: inv.amountMinor,
        status: 'pending',
        strategy: org.invoicingStrategy,
        due_date: dueDate,
      })),
    );

    // ---- Surplus -> reserve ----
    const surplus = invoicing.surplusToReserveMinor;
    if (surplus > 0) {
      const { data: last } = await admin
        .from('reserve_ledger')
        .select('balance_after')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      const balanceAfter = ((last as { balance_after: number } | null)?.balance_after ?? 0) + surplus;
      await admin.from('reserve_ledger').insert({
        amount: surplus,
        direction: 'in',
        reason: `Invoicing surplus from case ${theCase.id}`,
        case_id: theCase.id,
        balance_after: balanceAfter,
      });
      const { data: fund } = await admin.from('funds').select('id, balance').eq('name', 'Reserve Fund').single();
      if (fund) {
        await admin.from('funds').update({ balance: (fund as { balance: number }).balance + surplus }).eq('id', (fund as { id: string }).id);
      } else {
        await admin.from('funds').insert({ name: 'Reserve Fund', balance: surplus });
      }
    }

    await notifyMember(admin, {
      memberId: theCase.member_id,
      title: 'Benefit approved',
      body: `Your welfare case for ${theCase.deceased_name} has been approved for ${formatMoney(benefitAmount, org.currencySymbol, org.currencyCode)}. Voucher ${voucherNo} issued.`,
      type: 'case',
    });

    await logAudit(admin, {
      actorId: profile.id,
      action: 'case_approved',
      entity: 'case',
      entityId: theCase.id,
      details: {
        voucherId: voucher.id,
        voucherNo,
        invoicesCreated: invoicing.invoices.length,
        surplusToReserve: surplus,
        pairedCaseId,
        doublePayout: !!pairedCaseId,
      },
    });

    return Response.json({
      caseId: theCase.id,
      voucherId: voucher.id,
      invoicesCreated: invoicing.invoices.length,
      surplusToReserve: surplus,
      pairedCaseId,
    });
  } catch (e) {
    return handleGuardError(e);
  }
}
