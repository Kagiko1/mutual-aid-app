/**
 * Auth guards for API routes.
 *
 * - requireMember(): any authenticated user with a profiles row.
 * - requireAdmin():  requireMember() + role === 'admin'.
 * - checkTotp():     MFA gate for sensitive admin actions. TOTP must be
 *                    enabled on the admin profile; the current code must be
 *                    supplied in the `x-totp-code` header. If TOTP is not
 *                    enabled, a 428-style {error:'totp_required'} is thrown.
 *
 * Guards throw a Response on failure — catch it in the route and return it.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient, createAdminClient } from './supabase/server';
import { verifyTotp } from './totp';

export interface ProfileRow {
  id: string;
  role: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  national_id: string | null;
  status: string;
  totp_secret: string | null;
  totp_enabled: boolean;
  [key: string]: unknown;
}

export interface GuardContext {
  userId: string;
  profile: ProfileRow;
  /** Session-scoped client (respects RLS). */
  supabase: SupabaseClient;
  /** Service-role client (bypasses RLS) — use for writes. */
  admin: SupabaseClient;
}

function unauthorized(): Response {
  return Response.json({ error: 'unauthorized', message: 'Sign in required' }, { status: 401 });
}

export async function requireMember(): Promise<GuardContext> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw unauthorized();

  const admin = createAdminClient();
  const { data: profile, error } = await admin.from('profiles').select('*').eq('id', user.id).single();
  if (error || !profile) {
    throw Response.json({ error: 'forbidden', message: 'No member profile found' }, { status: 403 });
  }
  return { userId: user.id, profile: profile as ProfileRow, supabase, admin };
}

export async function requireAdmin(): Promise<GuardContext> {
  const ctx = await requireMember();
  if (ctx.profile.role !== 'admin') {
    throw Response.json({ error: 'forbidden', message: 'Admin access required' }, { status: 403 });
  }
  return ctx;
}

/**
 * Enforce TOTP for a sensitive admin action.
 * Reads the one-time code from the `x-totp-code` request header.
 */
export function checkTotp(request: Request, profile: ProfileRow): ProfileRow {
  if (!profile.totp_enabled || !profile.totp_secret) {
    throw Response.json(
      { error: 'totp_required', message: 'Enable TOTP first (POST /api/admin/totp/setup then /verify)' },
      { status: 428 },
    );
  }
  const code = request.headers.get('x-totp-code');
  if (!code || !verifyTotp(profile.totp_secret, code)) {
    throw Response.json(
      { error: 'invalid_totp', message: 'Missing or invalid TOTP code' },
      { status: 401 },
    );
  }
  return profile;
}

/** Route-level catch helper: returns thrown guard Responses, 500s anything else. */
export function handleGuardError(e: unknown): Response {
  if (e instanceof Response) return e;
  console.error('[api] unexpected error:', e);
  return Response.json({ error: 'internal_error' }, { status: 500 });
}
