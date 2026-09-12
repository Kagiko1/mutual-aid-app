/**
 * GET  /api/admin/payments — list this org's payment processor configs
 *                            (credentials returned masked-only, never raw).
 * POST /api/admin/payments — connect or update a processor.
 *   Body: { processor, environment?, purpose?, credentials?, is_active? }
 *   - credentials: raw field values; validated, encrypted, stored.
 *   - omit credentials when only toggling is_active/purpose.
 *   - activating one processor deactivates others covering the same purpose.
 */
import { NextRequest } from 'next/server';
import { requireAdmin, handleGuardError } from '@/lib/guard';
import { encryptCredentials, maskSecret } from '@/lib/payments/crypto';
import {
  getProcessorMeta,
  validateCredentials,
  PROCESSORS,
  type ProcessorId,
  type ProcessorEnvironment,
  type ProcessorRow,
} from '@/lib/payments/types';
import { logAudit } from '@/lib/audit';

type Purpose = 'collections' | 'payouts' | 'both';

function purposesCovered(purpose: Purpose): Purpose[] {
  return purpose === 'both' ? ['collections', 'payouts', 'both'] : [purpose, 'both'];
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAdmin(request);
    const { admin } = ctx;
    const { data, error } = await admin
      .from('org_payment_processors')
      .select('id, org_id, processor, environment, purpose, is_active, credentials_hint, last_tested_at, last_test_ok, created_at, updated_at')
      .eq('org_id', ctx.orgId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    const rows = (data ?? []) as ProcessorRow[];
    return Response.json({
      processors: rows.map((r) => ({ ...r, meta: publicMeta(r.processor) })),
      available: PROCESSORS.map((p) => publicMeta(p)),
    });
  } catch (e) {
    return handleGuardError(e);
  }
}

function publicMeta(id: ProcessorId) {
  const m = getProcessorMeta(id);
  return {
    id: m.id,
    name: m.name,
    tagline: m.tagline,
    regions: m.regions,
    currencies: m.currencies,
    supportsCollections: m.supportsCollections,
    supportsPayouts: m.supportsPayouts,
    testHint: m.testHint,
    fields: m.fields.map((f) => ({ ...f })),
  };
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAdmin(request);
    const { admin } = ctx;
    const body = (await request.json().catch(() => ({}))) as {
      processor?: string;
      environment?: string;
      purpose?: string;
      credentials?: Record<string, unknown>;
      is_active?: boolean;
    };

    const processor = body.processor as ProcessorId;
    if (!processor || !(PROCESSORS as readonly string[]).includes(processor)) {
      return Response.json({ error: 'unknown processor' }, { status: 400 });
    }
    const environment = (body.environment ?? 'test') as ProcessorEnvironment;
    if (!['test', 'live'].includes(environment)) {
      return Response.json({ error: 'environment must be test or live' }, { status: 400 });
    }
    const purpose = (body.purpose ?? 'both') as Purpose;
    if (!['collections', 'payouts', 'both'].includes(purpose)) {
      return Response.json({ error: 'invalid purpose' }, { status: 400 });
    }
    const meta = getProcessorMeta(processor);
    if (purpose !== 'collections' && !meta.supportsPayouts) {
      return Response.json({ error: `${meta.name} does not support payouts` }, { status: 400 });
    }
    if (purpose !== 'payouts' && !meta.supportsCollections) {
      return Response.json({ error: `${meta.name} does not support collections` }, { status: 400 });
    }

    const { data: existing } = await admin
      .from('org_payment_processors')
      .select('id, credentials_hint')
      .eq('org_id', ctx.orgId)
      .eq('processor', processor)
      .eq('environment', environment)
      .maybeSingle();

    // Credentials: validate + encrypt when supplied, else keep existing cipher.
    let cipher: string | undefined;
    let hint: Record<string, string> | undefined;
    if (body.credentials && Object.keys(body.credentials).length > 0) {
      const clean = validateCredentials(processor, body.credentials);
      cipher = encryptCredentials(ctx.orgId, clean);
      hint = {};
      for (const f of meta.fields) {
        const v = clean[f.key];
        if (v) hint[f.key] = f.secret ? maskSecret(v) : v;
      }
      if (!existing) {
        // New connection requires all required fields — validateCredentials enforces.
      }
    } else if (!existing) {
      return Response.json({ error: 'credentials are required to connect a processor' }, { status: 400 });
    }

    const isActive = body.is_active === true;
    const row = {
      org_id: ctx.orgId,
      processor,
      environment,
      purpose,
      is_active: isActive,
      ...(cipher ? { credentials_cipher: cipher, credentials_hint: hint } : {}),
    };

    let savedId: string;
    if (existing) {
      const { error } = await admin
        .from('org_payment_processors')
        .update(row)
        .eq('id', (existing as { id: string }).id);
      if (error) throw error;
      savedId = (existing as { id: string }).id;
    } else {
      const { data: ins, error } = await admin
        .from('org_payment_processors')
        .insert(row)
        .select('id')
        .single();
      if (error || !ins) throw error ?? new Error('insert failed');
      savedId = (ins as { id: string }).id;
    }

    // Single active processor per purpose: activating this one deactivates
    // others whose purpose overlaps.
    if (isActive) {
      const { data: others } = await admin
        .from('org_payment_processors')
        .select('id, purpose')
        .eq('org_id', ctx.orgId)
        .eq('is_active', true)
        .neq('id', savedId);
      const covered = purposesCovered(purpose);
      const toDeactivate = ((others ?? []) as { id: string; purpose: Purpose }[]).filter((o) =>
        purposesCovered(o.purpose).some((p) => covered.includes(p)),
      );
      for (const o of toDeactivate) {
        await admin.from('org_payment_processors').update({ is_active: false }).eq('id', o.id);
      }
    }

    await logAudit(admin, {
      actorId: ctx.profile.id,
      action: existing ? 'payment_processor_updated' : 'payment_processor_connected',
      entity: 'payment_processor',
      entityId: savedId,
      orgId: ctx.orgId,
      details: { processor, environment, purpose, is_active: isActive },
    });

    return Response.json({ ok: true, id: savedId });
  } catch (e) {
    if (e instanceof Error && /required|too long|unknown payment|PROCESSOR_CREDENTIALS_KEY/i.test(e.message)) {
      return Response.json({ error: 'invalid_credentials', message: e.message }, { status: 400 });
    }
    return handleGuardError(e);
  }
}
