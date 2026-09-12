/**
 * POST /api/admin/totp/verify
 * Body: { token: string }
 * Verifies a TOTP token against the stored secret; on success sets
 * totp_enabled=true so the MFA gate (checkTotp) passes from then on.
 */
import { NextRequest } from 'next/server';
import { requireAdmin, handleGuardError } from '@/lib/guard';
import { verifyTotp } from '@/lib/totp';
import { logAudit } from '@/lib/audit';

export async function POST(request: NextRequest) {
  try {
    const { profile, admin } = await requireAdmin();
    const body = await request.json().catch(() => ({}));
    const { token } = body as { token?: string };

    if (!profile.totp_secret || !verifyTotp(profile.totp_secret, token)) {
      return Response.json({ error: 'invalid_token', message: 'TOTP token did not verify' }, { status: 400 });
    }

    const { error } = await admin.from('profiles').update({ totp_enabled: true }).eq('id', profile.id);
    if (error) {
      return Response.json({ error: 'failed to enable totp', message: error.message }, { status: 500 });
    }

    await logAudit(admin, {
      actorId: profile.id,
      action: 'totp_enabled',
      entity: 'profile',
      entityId: profile.id,
      details: {},
    });

    return Response.json({ ok: true });
  } catch (e) {
    return handleGuardError(e);
  }
}
