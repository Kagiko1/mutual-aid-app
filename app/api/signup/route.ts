/**
 * POST /api/signup — public self-service signup (no auth).
 *
 * Body { mode: 'create_org', orgName, currency, fullName, email, password, phone? }
 *   → creates the organization (status 'trial'), seeds org config + Starter
 *     subscription, creates the auth user and an owner profile.
 *   → returns { ok: true, slug }.
 *
 * Body { mode: 'join', inviteCode, fullName, email, password, phone? }
 *   → joins an existing org via invite code with a pending member profile.
 *   → returns { ok: true }.
 */
import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { getOrganizationByInviteCode, seedOrgConfig, getOrganizationBySlug } from '@/lib/org';
import { isSupportedCurrency, getCurrency } from '@/lib/currency';

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'org'
  );
}

async function uniqueSlug(admin: ReturnType<typeof createAdminClient>, base: string): Promise<string> {
  let slug = base;
  for (let i = 2; i < 100; i++) {
    const existing = await getOrganizationBySlug(admin, slug);
    if (!existing) return slug;
    slug = `${base}-${i}`;
  }
  return `${base}-${Date.now().toString(36)}`;
}

function randomInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function bad(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { mode } = body as { mode?: string };
  if (mode !== 'create_org' && mode !== 'join') {
    return bad("mode must be 'create_org' or 'join'");
  }

  const { fullName, email, password, phone } = body as {
    fullName?: string;
    email?: string;
    password?: string;
    phone?: string;
  };
  if (!fullName?.trim() || !email?.trim() || !password) {
    return bad('fullName, email and password are required');
  }
  if (password.length < 6) {
    return bad('password must be at least 6 characters');
  }

  const admin = createAdminClient();

  // Resolve org + role depending on mode.
  let orgId: string;
  let role: string;
  let profileStatus: string;

  if (mode === 'create_org') {
    const { orgName, currency } = body as { orgName?: string; currency?: string };
    if (!orgName?.trim()) return bad('orgName is required');
    const currencyCode = (currency ?? 'KES').toUpperCase();
    if (!isSupportedCurrency(currencyCode)) return bad(`unsupported currency: ${currencyCode}`);

    const slug = await uniqueSlug(admin, slugify(orgName));

    const { data: plan } = await admin.from('plans').select('id').eq('name', 'Starter').single();
    if (!plan) return Response.json({ error: 'Starter plan not found' }, { status: 500 });

    const { data: org, error: orgError } = await admin
      .from('organizations')
      .insert({
        name: orgName.trim(),
        slug,
        currency_code: currencyCode,
        invite_code: randomInviteCode(),
        plan_id: (plan as { id: string }).id,
        status: 'trial',
      })
      .select('id')
      .single();
    if (orgError || !org) {
      return Response.json({ error: 'failed to create organization', message: orgError?.message }, { status: 500 });
    }
    orgId = (org as { id: string }).id;

    await seedOrgConfig(admin, orgId, {
      org_name: orgName.trim(),
      currency_code: currencyCode,
      currency_symbol: getCurrency(currencyCode).symbol,
    });

    const { error: subError } = await admin.from('subscriptions').upsert(
      { org_id: orgId, plan_id: (plan as { id: string }).id, status: 'trial' },
      { onConflict: 'org_id' },
    );
    if (subError) {
      console.error('[signup] subscription insert failed:', subError.message);
    }

    role = 'owner';
    profileStatus = 'active';

    // Create the auth user, then the owner profile.
    const { data: created, error: userError } = await admin.auth.admin.createUser({
      email: email.trim(),
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName.trim() },
    });
    if (userError || !created?.user) {
      const msg = (userError?.message ?? '').toLowerCase();
      if (msg.includes('already')) return bad('This email is already registered. Try signing in instead.');
      return Response.json({ error: 'failed to create user', message: userError?.message }, { status: 500 });
    }

    const { error: profileError } = await admin.from('profiles').insert({
      id: created.user.id,
      org_id: orgId,
      role,
      full_name: fullName.trim(),
      email: email.trim(),
      phone: phone?.trim() || null,
      status: profileStatus,
    });
    if (profileError) {
      console.error('[signup] profile insert failed:', profileError.message);
      return Response.json({ error: 'failed to create profile', message: profileError.message }, { status: 500 });
    }

    return Response.json({ ok: true, slug });
  }

  // mode === 'join'
  const { inviteCode } = body as { inviteCode?: string };
  if (!inviteCode?.trim()) return bad('inviteCode is required');
  const org = await getOrganizationByInviteCode(admin, inviteCode);
  if (!org) return bad('Invalid invite code');
  if (org.status === 'suspended') return bad('This organization has been suspended');

  orgId = org.id;
  role = 'member';
  profileStatus = 'pending';

  const { data: created, error: userError } = await admin.auth.admin.createUser({
    email: email.trim(),
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName.trim() },
  });
  if (userError || !created?.user) {
    const msg = (userError?.message ?? '').toLowerCase();
    if (msg.includes('already')) return bad('This email is already registered. Try signing in instead.');
    return Response.json({ error: 'failed to create user', message: userError?.message }, { status: 500 });
  }

  const { error: profileError } = await admin.from('profiles').insert({
    id: created.user.id,
    org_id: orgId,
    role,
    full_name: fullName.trim(),
    email: email.trim(),
    phone: phone?.trim() || null,
    status: profileStatus,
  });
  if (profileError) {
    console.error('[signup] profile insert failed:', profileError.message);
    return Response.json({ error: 'failed to create profile', message: profileError.message }, { status: 500 });
  }

  return Response.json({ ok: true });
}
