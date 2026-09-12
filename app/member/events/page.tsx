import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export default async function EventsPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: events } = await supabase
    .from('events')
    .select('id, title, description, event_date, location')
    .gte('event_date', new Date().toISOString())
    .order('event_date', { ascending: true });

  const { data: myAttendance } = await supabase
    .from('attendance')
    .select('event_id')
    .eq('member_id', user.id);
  const attending = new Set((myAttendance ?? []).map((a: any) => a.event_id));

  async function rsvp(formData: FormData) {
    'use server';
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error('You must be signed in.');
    const eventId = formData.get('eventId');
    if (typeof eventId !== 'string' || !eventId) throw new Error('Missing event id.');
    const { error } = await supabase
      .from('attendance')
      .insert({ event_id: eventId, member_id: user.id });
    // 23505 = unique violation → already registered; treat as success.
    if (error && (error as any).code !== '23505') throw new Error(error.message);
    revalidatePath('/member/events');
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold text-gray-900">Upcoming events</h1>
      <p className="mt-1 text-sm text-gray-600">RSVP to let organizers know you are coming.</p>

      {(events ?? []).length === 0 ? (
        <p className="mt-6 rounded-xl border bg-white p-6 text-sm text-gray-500 shadow-sm">
          No upcoming events scheduled.
        </p>
      ) : (
        <div className="mt-6 space-y-4">
          {(events ?? []).map((e: any) => {
            const isAttending = attending.has(e.id);
            return (
              <div key={e.id} className="rounded-xl border bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold text-gray-900">{e.title}</h2>
                    <p className="mt-1 text-sm text-gray-600">
                      {new Date(e.event_date).toLocaleString()}
                      {e.location ? ` · ${e.location}` : ''}
                    </p>
                    {e.description && (
                      <p className="mt-2 text-sm text-gray-600">{e.description}</p>
                    )}
                  </div>
                  {isAttending ? (
                    <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
                      Attending
                    </span>
                  ) : (
                    <form action={rsvp}>
                      <input type="hidden" name="eventId" value={e.id} />
                      <button
                        type="submit"
                        className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
                      >
                        RSVP
                      </button>
                    </form>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
