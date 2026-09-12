/**
 * /api/super/fx — SaaS operator FX rate management.
 * GET — { rates: [{ base_currency, quote_currency, rate, updated_at }] }.
 * PUT — { rates: [{ base_currency, quote_currency, rate }] } upserts rows.
 */
import { NextRequest } from 'next/server';
import { requireSuperAdmin, handleGuardError } from '@/lib/guard';

export async function GET() {
  try {
    const { admin } = await requireSuperAdmin();
    const { data, error } = await admin
      .from('fx_rates')
      .select('base_currency, quote_currency, rate, updated_at')
      .order('base_currency')
      .order('quote_currency');
    if (error) return Response.json({ error: 'failed to load rates', message: error.message }, { status: 500 });
    return Response.json({ rates: data ?? [] });
  } catch (e) {
    return handleGuardError(e);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { admin } = await requireSuperAdmin();
    const body = await request.json().catch(() => ({}));
    const { rates } = body as {
      rates?: { base_currency?: string; quote_currency?: string; rate?: number }[];
    };
    if (!Array.isArray(rates) || rates.length === 0) {
      return Response.json({ error: 'rates must be a non-empty array' }, { status: 400 });
    }

    const rows = [];
    for (const r of rates) {
      const base = r.base_currency?.toUpperCase().trim();
      const quote = r.quote_currency?.toUpperCase().trim();
      const rate = Number(r.rate);
      if (!base || !quote || !Number.isFinite(rate) || rate <= 0) {
        return Response.json(
          { error: 'each rate needs base_currency, quote_currency and a positive rate' },
          { status: 400 },
        );
      }
      rows.push({ base_currency: base, quote_currency: quote, rate, updated_at: new Date().toISOString() });
    }

    const { error } = await admin
      .from('fx_rates')
      .upsert(rows, { onConflict: 'base_currency,quote_currency' });
    if (error) return Response.json({ error: 'failed to save rates', message: error.message }, { status: 500 });

    return Response.json({ ok: true, saved: rows.length });
  } catch (e) {
    return handleGuardError(e);
  }
}
