import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveOrgContext } from '@/lib/org-context';
import { getOrganizationBySlug } from '@/lib/org';

/**
 * POST /api/super/view-org { slug: string | null }
 * Super-admins only: sets (or clears) the httpOnly `view_org` cookie used by
 * resolveOrgContext to impersonate an organization in the admin console.
 */
export async function POST(request: Request) {
  try {
    const admin = createAdminClient();
    const { isSuperAdmin } = await resolveOrgContext(admin);
    if (!isSuperAdmin) {
      return NextResponse.json({ error: 'forbidden', message: 'Super admin only' }, { status: 403 });
    }

    const body = (await request.json().catch(() => ({}))) as { slug?: string | null };
    const slug = typeof body.slug === 'string' && body.slug.trim() !== '' ? body.slug.trim() : null;

    if (slug) {
      const org = await getOrganizationBySlug(admin, slug);
      if (!org) {
        return NextResponse.json({ error: 'not_found', message: 'Organization not found' }, { status: 404 });
      }
      cookies().set('view_org', org.slug, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 8,
      });
      return NextResponse.json({ ok: true, slug: org.slug });
    }

    cookies().delete('view_org');
    return NextResponse.json({ ok: true, slug: null });
  } catch (err) {
    if (err instanceof Response) return err;
    return NextResponse.json({ error: 'failed', message: 'Could not switch organization' }, { status: 500 });
  }
}
