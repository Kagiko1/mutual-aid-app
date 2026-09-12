/**
 * POST /api/mpesa/b2c/route.ts
 * Body: { disbursementId }  OR  { phone, amountMinor, remarks }
 *
 * Admin-only (TOTP-gated) B2C payout. With a disbursementId the payout is
 * recorded against that disbursement row; otherwise just returns the Daraja IDs.
 *
 * Disbursement reconciliation: at send time mpesa_receipt is set to the
 * OriginatorConversationID and status is 'pending' (live) / 'completed' (stub).
 * /api/mpesa/b2c-callback matches on that value and swaps in the real
 * TransactionReceipt on success.
 */
import { NextRequest } from 'next/server';
import { requireAdmin, checkTotp, handleGuardError } from '@/lib/guard';
import { resolveProcessor } from '@/lib/payments';
import { logAudit } from '@/lib/audit';

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAdmin(request);
    const { profile, admin } = ctx;
    checkTotp(request, profile);

    const body = await request.json().catch(() => ({}));
    const { disbursementId, phone, amountMinor, remarks } = body as {
      disbursementId?: string;
      phone?: string;
      amountMinor?: number;
      remarks?: string;
    };

    let targetPhone = phone;
    let amount = amountMinor;
    let disb: Record<string, unknown> | null = null;

    if (disbursementId) {
      const { data, error } = await admin
        .from('disbursements')
        .select('*')
        .eq('id', disbursementId)
        .eq('org_id', ctx.orgId)
        .single();
      if (error || !data) {
        return Response.json({ error: 'disbursement not found' }, { status: 404 });
      }
      disb = data as Record<string, unknown>;
      // Prefer an explicit phone, fall back to the beneficiary's registered phone.
      if (!phone && (data as { beneficiary_id?: string | null }).beneficiary_id) {
        const { data: ben } = await admin
          .from('beneficiaries')
          .select('phone')
          .eq('id', (data as { beneficiary_id: string }).beneficiary_id)
          .eq('org_id', ctx.orgId)
          .single();
        targetPhone = (ben as { phone?: string | null } | null)?.phone ?? undefined;
      }
      amount = amountMinor ?? (data as { amount: number }).amount;
    }

    if (!targetPhone || !Number.isInteger(amount) || (amount as number) <= 0) {
      return Response.json(
        { error: 'phone and a positive integer amountMinor are required (or a payable disbursementId)' },
        { status: 400 },
      );
    }

    const currency: string = (disb?.currency_code as string) ?? ctx.org.currency_code ?? 'KES';
    const proc = await resolveProcessor(admin, ctx.orgId, 'payouts', currency);

    const result = await proc.payout({
      phone: targetPhone,
      amountMinor: amount as number,
      currency,
      beneficiaryName: (disb?.beneficiary_name as string) ?? undefined,
      remarks: (remarks ?? `Benefit payout${disb ? ` ${(disb.beneficiary_name as string) ?? ''}` : ''}`).trim(),
    });

    if (disb) {
      await admin
        .from('disbursements')
        .update({
          channel: result.channel,
          mpesa_receipt: result.providerRef,
          status: result.settled ? 'completed' : 'pending',
        })
        .eq('id', disb.id)
        .eq('org_id', ctx.orgId);
    }

    await logAudit(admin, {
      actorId: profile.id,
      action: 'payout_sent',
      entity: 'disbursement',
      entityId: (disb?.id as string) ?? null,
      orgId: ctx.orgId,
      details: {
        phone: targetPhone,
        amountMinor: amount,
        processor: proc.processor,
        channel: result.channel,
        providerRef: result.providerRef,
        settled: result.settled,
      },
    });

    return Response.json({
      processor: proc.processor,
      channel: result.channel,
      providerRef: result.providerRef,
      status: result.settled ? 'completed' : 'pending',
      disbursementId: disb?.id ?? null,
    });
  } catch (e) {
    if (e instanceof Error && /phone|processor_currency_unsupported|payouts_unsupported|mpesa_kes_only/i.test(e.message)) {
      return Response.json({ error: 'payout_error', message: e.message }, { status: 400 });
    }
    if (e instanceof Error && /failed|key|credential|secret/i.test(e.message)) {
      return Response.json({ error: 'processor_error', message: e.message }, { status: 502 });
    }
    return handleGuardError(e);
  }
}
