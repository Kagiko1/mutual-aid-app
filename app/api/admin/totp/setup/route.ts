/**
 * POST /api/admin/totp/setup
 * Generates a TOTP secret for the calling admin and stores it on their
 * profile (totp_enabled stays false until /verify confirms a valid token).
 * Returns { secret, otpauthUrl } — render otpauthUrl as a QR code in the UI.
 */
import { requireAdmin, handleGuardError } from '@/lib/guard';
import { generateTotpSecret, totpAuthUrl } from '@/lib/totp';
import { logAudit } from '@/lib/audit';

export async function POST() {
  try {
    const { profile, admin } = await requireAdmin();

    const secret = generateTotpSecret();
    const { error } = await admin
      .from('profiles')
      .update({ totp_secret: secret, totp_enabled: false })
      .eq('id', profile.id);
    if (error) {
      return Response.json({ error: 'failed to save secret', message: error.message }, { status: 500 });
    }

    const otpauthUrl = totpAuthUrl(secret, profile.email ?? profile.full_name, 'Mutual Aid');

    await logAudit(admin, {
      actorId: profile.id,
      action: 'totp_setup_initiated',
      entity: 'profile',
      entityId: profile.id,
      details: {},
    });

    return Response.json({ secret, otpauthUrl, otpauth_url: otpauthUrl });
  } catch (e) {
    return handleGuardError(e);
  }
}
