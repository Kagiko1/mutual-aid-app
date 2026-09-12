/**
 * /api/notifications
 * GET   — the caller's own notifications, newest first.
 * PATCH — mark as read. Body: { ids?: string[], all?: boolean }
 *         (ids are always scoped to the caller's own notifications).
 */
import { NextRequest } from 'next/server';
import { requireMember, handleGuardError } from '@/lib/guard';

export async function GET() {
  try {
    const { userId, admin } = await requireMember();
    const { data, error } = await admin
      .from('notifications')
      .select('*')
      .eq('member_id', userId)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) {
      return Response.json({ error: 'failed to load notifications', message: error.message }, { status: 500 });
    }
    return Response.json({ notifications: data ?? [] });
  } catch (e) {
    return handleGuardError(e);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { userId, admin } = await requireMember();
    const body = await request.json().catch(() => ({}));
    const { ids, all } = body as { ids?: string[]; all?: boolean };

    if (!all && (!Array.isArray(ids) || ids.length === 0)) {
      return Response.json({ error: 'provide ids[] or { all: true }' }, { status: 400 });
    }

    const now = new Date().toISOString();
    let query = admin.from('notifications').update({ read_at: now }).eq('member_id', userId);
    if (!all && ids) query = query.in('id', ids);
    else query = query.is('read_at', null);

    const { error } = await query;
    if (error) {
      return Response.json({ error: 'failed to mark notifications read', message: error.message }, { status: 500 });
    }
    return Response.json({ ok: true });
  } catch (e) {
    return handleGuardError(e);
  }
}
