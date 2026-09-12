/**
 * POST /api/cases/[id]/disburse
 * Body: {} (no fields required)
 *
 * Admin-only, TOTP-gated. Case must be 'approved' with a voucher issued.
 * Splits the voucher amount across the member's beneficiaries (largest
 * remainder), creates disbursement rows, and fires a B2C payout per
 * beneficiary. In stub mode payouts complete immediately; in live mode they
 * stay pending until /api/mpesa/b2c-callback reconciles them.
 */
import { NextRequest } from 'next/server';
import { requireAdmin, checkTotp, handleGuardError } from '@/lib/guard';
import { getOrgConfig } from '@/lib/org';
import { splitBeneficiaries, validatePercentages } from '@/lib/engines/beneficiarySplit';
import { b2cPayment, isStub } from '@/lib/mpesa';
import { logAudit } from '@/lib/audit';
import { notifyMember } from '@/lib/notify';
import { formatMoney } from '@/lib/money';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireAdmin(request);
    const { profile, admin } = ctx;
    checkTotp(request, profile);

    const { data: theCase } = await admin.from('cases').select('*').eq('id', params.id).eq('org_id', ctx.orgId).single();
    if (!theCase) return Response.json({ error: 'case not found' }, { status: 404 });
    if (theCase.status !== 'approved') {
      return Response.json(
        { error: 'invalid_case_status', message: `Case is ${theCase.status}; only approved cases can be disbursed` },
        { status: 400 },
      );
    }

    const { data: voucher } = await admin.from('vouchers').select('*').eq('case_id', params.id).eq('org_id', ctx.orgId).single();
    if (!voucher) return Response.json({ error: 'no voucher issued for this case' }, { status: 400 });

    const { data: beneficiaries } = await admin
      .from('beneficiaries')
      .select('*')
      .eq('member_id', theCase.member_id);
    const bens = (beneficiaries ?? []) as {
      id: string;
      full_name: string;
      percentage: number | string;
      phone: string | null;
    }[];
    const shares = bens.map((b) => ({ id: b.id, percentage: Number(b.percentage) }));
    try {
      validatePercentages(shares);
    } catch (e) {
      return Response.json(
        { error: 'invalid_beneficiaries', message: e instanceof Error ? e.message : 'Invalid beneficiary split' },
        { status: 400 },
      );
    }

    const cfg = await getOrgConfig(admin, ctx.orgId);
    // Disbursements inherit the case's currency.
    const caseCurrency: string = theCase.currency_code ?? cfg.currencyCode;
    const allocations = splitBeneficiaries(voucher.amount, shares);
    const results: { beneficiaryId: string; beneficiaryName: string; amountMinor: number; status: string }[] = [];

    for (const alloc of allocations) {
      const ben = bens.find((b) => b.id === alloc.beneficiaryId)!;
      const { data: disb, error: disbErr } = await admin
        .from('disbursements')
        .insert({
          org_id: ctx.orgId,
          case_id: theCase.id,
          beneficiary_id: ben.id,
          beneficiary_name: ben.full_name,
          amount: alloc.amountMinor,
          currency_code: caseCurrency,
          channel: 'mpesa_b2c',
          status: 'pending',
        })
        .select()
        .single();
      if (disbErr || !disb) {
        results.push({ beneficiaryId: ben.id, beneficiaryName: ben.full_name, amountMinor: alloc.amountMinor, status: 'failed' });
        continue;
      }

      // No phone on file -> leave pending for manual payout via /api/mpesa/b2c.
      if (ben.phone) {
        try {
          const pay = await b2cPayment({
            phone: ben.phone,
            amountMinor: alloc.amountMinor,
            remarks: `Benefit payout ${voucher.voucher_no} - ${ben.full_name}`.slice(0, 100),
          });
          await admin
            .from('disbursements')
            .update({
              mpesa_receipt: pay.originatorConversationId,
              status: isStub() ? 'completed' : 'pending',
            })
            .eq('id', disb.id);
          results.push({
            beneficiaryId: ben.id,
            beneficiaryName: ben.full_name,
            amountMinor: alloc.amountMinor,
            status: isStub() ? 'completed' : 'pending',
          });
        } catch (e) {
          console.error(`[disburse] B2C failed for ${ben.full_name}:`, e);
          await admin.from('disbursements').update({ status: 'failed' }).eq('id', disb.id);
          results.push({ beneficiaryId: ben.id, beneficiaryName: ben.full_name, amountMinor: alloc.amountMinor, status: 'failed' });
        }
      } else {
        results.push({ beneficiaryId: ben.id, beneficiaryName: ben.full_name, amountMinor: alloc.amountMinor, status: 'pending' });
      }
    }

    const now = new Date().toISOString();
    await admin.from('cases').update({ status: 'disbursed', disbursed_at: now }).eq('id', theCase.id).eq('org_id', ctx.orgId);

    await notifyMember(admin, {
      memberId: theCase.member_id,
      title: 'Benefit disbursed',
      body: `${formatMoney(voucher.amount, caseCurrency)} has been disbursed to ${bens.length} beneficiar${bens.length === 1 ? 'y' : 'ies'} for ${theCase.deceased_name}.`,
      type: 'case',
      orgId: ctx.orgId,
    });

    await logAudit(admin, {
      actorId: profile.id,
      action: 'case_disbursed',
      entity: 'case',
      entityId: theCase.id,
      orgId: ctx.orgId,
      details: { voucherNo: voucher.voucher_no, allocations: results },
    });

    return Response.json({ caseId: theCase.id, allocations: results });
  } catch (e) {
    return handleGuardError(e);
  }
}
