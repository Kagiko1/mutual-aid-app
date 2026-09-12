/**
 * POST /api/mpesa/b2c-callback
 * Daraja B2C ResultURL/QueueTimeOutURL. No auth — Daraja calls this directly.
 * Always answers {ResultCode:0, ResultDesc:'Accepted'}.
 *
 * Body shape: { Result: { ResultCode, ResultDesc, OriginatorConversationID,
 *   ConversationID, ResultParameters: { ResultParameter: [{ Key, Value }] } } }
 *
 * Reconciles the disbursement whose mpesa_receipt holds the
 * OriginatorConversationID (set at send time by /api/mpesa/b2c).
 * On success the receipt is replaced with the real TransactionReceipt.
 */
import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { logAudit } from '@/lib/audit';

const ACCEPTED = { ResultCode: 0, ResultDesc: 'Accepted' };

export async function POST(request: NextRequest) {
  const admin = createAdminClient();
  try {
    const body = await request.json().catch(() => ({}));
    const result = body?.Result ?? {};
    const originatorId: string | undefined = result.OriginatorConversationID;
    const resultCode: number | undefined = result.ResultCode;
    console.log('[mpesa] B2C callback received:', JSON.stringify({ originatorId, resultCode }));

    if (!originatorId) {
      console.warn('[mpesa] B2C callback missing OriginatorConversationID');
      return Response.json(ACCEPTED);
    }

    const { data: disb } = await admin
      .from('disbursements')
      .select('*')
      .eq('mpesa_receipt', originatorId)
      .single();

    if (!disb) {
      console.warn(`[mpesa] no disbursement found for originatorConversationId=${originatorId}`);
      return Response.json(ACCEPTED);
    }

    const params: { Key?: string; Value?: unknown }[] =
      result?.ResultParameters?.ResultParameter ?? [];
    const receiptParam = params.find((p) => p.Key === 'TransactionReceipt');
    const txReceipt = receiptParam?.Value != null ? String(receiptParam.Value) : originatorId;

    if (resultCode === 0) {
      await admin
        .from('disbursements')
        .update({ status: 'completed', mpesa_receipt: txReceipt })
        .eq('id', disb.id);
      await logAudit(admin, {
        actorId: null,
        action: 'b2c_payment_completed',
        entity: 'disbursement',
        entityId: disb.id,
        details: { originatorConversationId: originatorId, transactionReceipt: txReceipt },
      });
    } else {
      await admin.from('disbursements').update({ status: 'failed' }).eq('id', disb.id);
      await logAudit(admin, {
        actorId: null,
        action: 'b2c_payment_failed',
        entity: 'disbursement',
        entityId: disb.id,
        details: { originatorConversationId: originatorId, resultCode, resultDesc: result.ResultDesc },
      });
      console.warn(`[mpesa] B2C payout failed for ${originatorId}: ResultCode=${resultCode}`);
    }

    return Response.json(ACCEPTED);
  } catch (e) {
    console.error('[mpesa] B2C callback handler error:', e);
    return Response.json(ACCEPTED);
  }
}
