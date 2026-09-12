import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveOrgContext } from '@/lib/org-context';
import { requireAdmin } from '@/lib/admin/guard';
import { fmtDate } from '@/lib/admin/config';
import { Card, PageHeader, EmptyState, inputCls, btnPrimary, btnDanger } from '@/components/admin/ui';
import NotifyButton from '@/components/admin/NotifyButton';

export default async function EventsPage() {
  const admin = createAdminClient();
  const { orgId } = await resolveOrgContext(admin);

  async function createEvent(formData: FormData) {
    'use server';
    const session = await requireAdmin();
    const admin = createAdminClient();
    const title = String(formData.get('title') || '').trim();
    if (!title) return;
    const rawDate = String(formData.get('event_date') || '');
    await admin.from('events').insert({
      org_id: orgId,
      title,
      description: String(formData.get('description') || '').trim() || null,
      event_date: rawDate ? new Date(rawDate).toISOString() : new Date().toISOString(),
      location: String(formData.get('location') || '').trim() || null,
      created_by: session.userId,
    });
    revalidatePath('/admin/events');
  }

  async function deleteEvent(formData: FormData) {
    'use server';
    await requireAdmin();
    const admin = createAdminClient();
    await admin.from('events').delete().eq('org_id', orgId).eq('id', String(formData.get('id')));
    revalidatePath('/admin/events');
  }

  const { data: events } = await admin.from('events').select('*').eq('org_id', orgId).order('event_date', { ascending: false });
  const eventRows = (events ?? []) as {
    id: string;
    title: string;
    description: string | null;
    event_date: string;
    location: string | null;
  }[];

  const { data: attendance } = eventRows.length
    ? await admin.from('attendance').select('event_id, member_id, attended_at').eq('org_id', orgId).in('event_id', eventRows.map((e) => e.id))
    : { data: [] };
  const attRows = (attendance ?? []) as { event_id: string; member_id: string; attended_at: string }[];
  const attByEvent = new Map<string, { member_id: string; attended_at: string }[]>();
  for (const a of attRows) {
    const list = attByEvent.get(a.event_id) ?? [];
    list.push({ member_id: a.member_id, attended_at: a.attended_at });
    attByEvent.set(a.event_id, list);
  }
  const attMemberIds = Array.from(new Set(attRows.map((a) => a.member_id)));
  const { data: profiles } = attMemberIds.length
    ? await admin.from('profiles').select('id, full_name').eq('org_id', orgId).in('id', attMemberIds)
    : { data: [] };
  const nameOf = new Map(((profiles ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name]));

  return (
    <div>
      <PageHeader title="Events" subtitle="Meetings, fundraisers and gatherings with attendance tracking." />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card title="Create event" className="xl:col-span-1">
          <form action={createEvent} className="space-y-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">Title *</label>
              <input name="title" required className={inputCls} placeholder="e.g. Annual general meeting" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">Description</label>
              <textarea name="description" rows={2} className={inputCls} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-600">Date & time</label>
                <input name="event_date" type="datetime-local" className={inputCls} />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-600">Location</label>
                <input name="location" className={inputCls} placeholder="Venue" />
              </div>
            </div>
            <button type="submit" className={btnPrimary}>Create event</button>
          </form>
        </Card>

        <div className="space-y-4 xl:col-span-2">
          {eventRows.length === 0 && (
            <Card><EmptyState message="No events yet." /></Card>
          )}
          {eventRows.map((e) => {
            const attendees = attByEvent.get(e.id) ?? [];
            return (
              <Card
                key={e.id}
                title={e.title}
                action={
                  <div className="flex items-center gap-2">
                    <NotifyButton eventId={e.id} eventTitle={e.title} />
                    <form action={deleteEvent}>
                      <input type="hidden" name="id" value={e.id} />
                      <button type="submit" className={btnDanger}>Delete</button>
                    </form>
                  </div>
                }
              >
                {e.description && <p className="mb-2 text-sm text-slate-600">{e.description}</p>}
                <p className="text-xs text-slate-500">
                  {fmtDate(e.event_date)}
                  {e.location ? ` · ${e.location}` : ''}
                </p>
                <h4 className="mb-1 mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Attendance ({attendees.length})
                </h4>
                {attendees.length === 0 ? (
                  <p className="text-sm text-slate-400">No attendance recorded.</p>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {attendees.map((a) => (
                      <li key={a.member_id} className="flex items-center justify-between py-1.5 text-sm">
                        <span className="text-slate-700">{nameOf.get(a.member_id) ?? a.member_id}</span>
                        <span className="text-xs text-slate-400">{fmtDate(a.attended_at)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
