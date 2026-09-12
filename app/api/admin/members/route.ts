/**
 * POST /api/admin/members
 * Body: { email, full_name, phone?, national_id?, role?, status?, password? }
 *
 * "Onboard on behalf": admin creates the auth user, then a member profile
 * with waiting_ends_at = now + waitingPeriodDays. If no password is supplied,
 * a secure temporary password is generated and returned once as tempPassword
 * for the admin to share with the member.
 */
import { randomBytes } from 'crypto';
import { NextRequest } from 'next/server';
import { requireAdmin, handleGuardError } from '@/lib/guard';
import { getOrgConfig } from '@/lib/org';
import { logAudit } from '@/lib/audit';

const ROLES = ['member', 'admin'] as const;
const STATUSES = ['pending', 'active', 'ineligible', 'suspended'] as const;

export async function POST(request: NextRequest) {
  try {
    const { profile, admin } = await requireAdmin();
    const body = await request.json().catch(() => ({}));
    const { email, password, full_name, phone, national_id, role, status } = body as {
      email?: string;
      password?: string;
      full_name?: string;
      phone?: string;
      national_id?: string;
      role?: string;
      status?: string;
    };

    if (!email || !full_name) {
      return Response.json({ error: 'email and full_name are required' }, { status: 400 });
    }
    const safeRole = ROLES.includes(role as (typeof ROLES)[number]) ? (role as string) : 'member';
    const safeStatus = STATUSES.includes(status as (typeof STATUSES)[number])
      ? (status as string)
      : 'pending';
    // Generate a one-time temporary password when the admin doesn't supply one.
    const tempPassword = password || randomBytes(12).toString('base64url');
    const generated = !password;

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { full_name },
    });
    if (createErr || !created.user) {
      return Response.json(
        { error: 'failed to create user', message: createErr?.message },
        { status: 400 },
      );
    }

    const org = await getOrgConfig(admin);
    const waitingEndsAt = new Date(Date.now() + org.waitingPeriodDays * 86400000).toISOString();
    const { error: profileErr } = await admin.from('profiles').insert({
      id: created.user.id,
      role: safeRole,
      full_name,
      email,
      phone: phone ?? null,
      national_id: national_id ?? null,
      status: safeStatus,
      waiting_ends_at: waitingEndsAt,
    });
    if (profileErr) {
      // Roll back the orphaned auth user so a retry doesn't hit "already exists".
      await admin.auth.admin.deleteUser(created.user.id);
      return Response.json({ error: 'failed to create profile', message: profileErr.message }, { status: 500 });
    }

    await logAudit(admin, {
      actorId: profile.id,
      action: 'member_onboarded',
      entity: 'profile',
      entityId: created.user.id,
      details: { email, full_name, role: safeRole, status: safeStatus, waiting_ends_at: waitingEndsAt },
    });

    return Response.json(
      { userId: created.user.id, waitingEndsAt, ...(generated ? { tempPassword } : {}) },
      { status: 201 },
    );
  } catch (e) {
    return handleGuardError(e);
  }
}
