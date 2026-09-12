/**
 * Org context resolution for server components and API routes.
 *
 * Regular users belong to exactly one organization (profiles.org_id).
 * Super admins (SaaS operators) can impersonate any org via ?org=<slug>
 * or the `view_org` cookie (set by the org switcher in the admin nav).
 */
import { cookies } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient, createAdminClient } from './supabase/server';
import { getOrganizationBySlug, type Organization } from './org';

export interface OrgProfile {
  id: string;
  role: string;
  is_super_admin: boolean;
  org_id: string;
  full_name: string;
  status: string;
}

export interface OrgContext {
  orgId: string;
  org: Organization;
  profile: OrgProfile;
  isSuperAdmin: boolean;
}

function forbidden(message: string): Response {
  return Response.json({ error: 'forbidden', message }, { status: 403 });
}

/**
 * Resolve the organization for the current request.
 * Throws a Response on auth failure — catch with handleGuardError or let it propagate.
 */
export async function resolveOrgContext(admin: SupabaseClient, orgSlugOverride?: string): Promise<OrgContext> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw Response.json({ error: 'unauthorized', message: 'Sign in required' }, { status: 401 });

  const { data: profile, error } = await admin
    .from('profiles')
    .select('id, role, is_super_admin, org_id, full_name, status')
    .eq('id', user.id)
    .single();
  if (error || !profile) throw forbidden('No member profile found');

  let orgId = profile.org_id as string;
  const isSuperAdmin = !!profile.is_super_admin;

  if (isSuperAdmin) {
    const override = orgSlugOverride ?? cookies().get('view_org')?.value;
    if (override) {
      const target = await getOrganizationBySlug(admin, override);
      if (target) orgId = target.id;
    }
  }

  const { data: org } = await admin.from('organizations').select('*').eq('id', orgId).single();
  if (!org) throw forbidden('No organization found');
  if (org.status === 'suspended' && !isSuperAdmin) {
    throw forbidden('This organization has been suspended. Contact support.');
  }

  return { orgId, org: org as Organization, profile: profile as OrgProfile, isSuperAdmin };
}

/** Pull ?org=<slug> from a Request URL for super-admin org switching in API routes. */
export function orgSlugFromRequest(request: Request): string | undefined {
  return new URL(request.url).searchParams.get('org') ?? undefined;
}
