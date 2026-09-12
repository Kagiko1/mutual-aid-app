/**
 * POST /api/admin/events/[id]/notify
 * Body: {} (no fields required)
 *
 * Admin-only. Broadcasts an event notice (title/date/location) to all members
 * via notifyAllMembers (in-app notification + best-effort SMS).
 */
import { NextRequest } from 'next/server';
import { requireAdmin, handleGuardError } from '@/lib/guard';
import { notifyAllMembers } from '@/lib/notify';
import { logAudit } from '@/lib/audit';

export async function POST(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { profile, admin } = await requireAdmin();

    const { data: event } = await admin.from('events').select('*').eq('id', params.id).single();
    if (!event) return Response.json({ error: 'event not found' }, { status: 404 });

    const when = new Date(event.event_date).toLocaleString('en-KE', {
      timeZone: 'Africa/Nairobi',
      dateStyle: 'medium',
      timeStyle: 'short',
    });
    const body = [`${when}`, event.location ? `Venue: ${event.location}` : null, event.description ?? null]
      .filter(Boolean)
      .join('\n');

    const notified = await notifyAllMembers(admin, {
      title: `Event: ${event.title}`,
      body,
      type: 'event',
    });

    await logAudit(admin, {
      actorId: profile.id,
      action: 'event_notified',
      entity: 'event',
      entityId: event.id,
      details: { notified },
    });

    return Response.json({ ok: true, notified });
  } catch (e) {
    return handleGuardError(e);
  }
}
