/**
 * POST /api/admin/payments/test — verify processor credentials without saving.
 * Body: { processor, environment?, credentials }  OR  { id } (test saved config)
 */
import { NextRequest } from 'next/server';
import { requireAdmin, handleGuardError } from '@/lib/guard';
import { validateCredentials, getProcessorMeta, PROCESSORS, type ProcessorId, type ProcessorEnvironment } from '@/lib/payments/types';
import { decryptCredentials } from '@/lib/payments/crypto';
import { testConnection } from '@/lib/payments';

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAdmin(request);
    const { admin } = ctx;
    const body = (await request.json().catch(() => ({}))) as {
      id?: string;
      processor?: string;
      environment?: string;
      credentials?: Record<string, unknown>;
    };

    let processor: ProcessorId;
    let environment: ProcessorEnvironment;
    let creds: Record<string, string>;
    let rowId: string | null = null;

    if (body.id) {
      const { data: row, error } = await admin
        .from('org_payment_processors')
        .select('id, processor, environment, credentials_cipher')
        .eq('id', body.id)
        .eq('org_id', ctx.orgId)
        .single();
      if (error || !row) return Response.json({ error: 'not found' }, { status: 404 });
      const r = row as { id: string; processor: ProcessorId; environment: ProcessorEnvironment; credentials_cipher: string };
      processor = r.processor;
      environment = r.environment;
      creds = decryptCredentials(ctx.orgId, r.credentials_cipher);
      rowId = r.id;
    } else {
      processor = body.processor as ProcessorId;
      if (!processor || !(PROCESSORS as readonly string[]).includes(processor)) {
        return Response.json({ error: 'unknown processor' }, { status: 400 });
      }
      environment = (body.environment ?? 'test') as ProcessorEnvironment;
      if (!body.credentials) return Response.json({ error: 'credentials required' }, { status: 400 });
      creds = validateCredentials(processor, body.credentials);
    }

    const detail = await testConnection(processor, environment, creds);

    if (rowId) {
      await admin
        .from('org_payment_processors')
        .update({ last_tested_at: new Date().toISOString(), last_test_ok: true })
        .eq('id', rowId);
    }

    return Response.json({ ok: true, processor: getProcessorMeta(processor).name, detail });
  } catch (e) {
    if (e instanceof Error && !/Guard|auth/i.test(e.message)) {
      // Mark saved config as failed test (best effort).
      return Response.json({ ok: false, error: 'connection_failed', message: e.message }, { status: 502 });
    }
    return handleGuardError(e);
  }
}
