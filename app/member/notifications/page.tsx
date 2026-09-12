'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

interface Notification {
  id: string;
  title: string;
  body: string | null;
  type: string;
  read_at: string | null;
  created_at: string;
}

export default function NotificationsPage() {
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error('You must be signed in.');
      const { data, error: qErr } = await supabase
        .from('notifications')
        .select('id, title, body, type, read_at, created_at')
        .eq('member_id', user.id)
        .order('created_at', { ascending: false });
      if (qErr) throw new Error(qErr.message);
      setItems((data as Notification[]) ?? []);
    } catch (err: any) {
      setError(err.message ?? 'Failed to load notifications.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const markRead = async (id: string) => {
    setBusyId(id);
    try {
      const supabase = createClient();
      const { error: uErr } = await supabase
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('id', id);
      if (uErr) throw new Error(uErr.message);
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)));
    } catch (err: any) {
      setError(err.message ?? 'Failed to update notification.');
    } finally {
      setBusyId(null);
    }
  };

  const markAllRead = async () => {
    setBusyId('all');
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error('You must be signed in.');
      const { error: uErr } = await supabase
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('member_id', user.id)
        .is('read_at', null);
      if (uErr) throw new Error(uErr.message);
      await load();
    } catch (err: any) {
      setError(err.message ?? 'Failed to update notifications.');
    } finally {
      setBusyId(null);
    }
  };

  const unreadCount = items.filter((n) => !n.read_at).length;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Notifications</h1>
        {unreadCount > 0 && (
          <button
            onClick={markAllRead}
            disabled={busyId === 'all'}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {busyId === 'all' ? 'Updating...' : 'Mark all read'}
          </button>
        )}
      </div>

      {error && (
        <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p className="mt-6 text-sm text-gray-500">Loading notifications...</p>
      ) : items.length === 0 ? (
        <p className="mt-6 rounded-xl border bg-white p-6 text-sm text-gray-500 shadow-sm">
          No notifications yet.
        </p>
      ) : (
        <ul className="mt-6 space-y-3">
          {items.map((n) => (
            <li
              key={n.id}
              className={`rounded-xl border bg-white p-5 shadow-sm ${n.read_at ? 'opacity-70' : 'border-emerald-200'}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-gray-900">{n.title}</p>
                  {n.body && <p className="mt-1 text-sm text-gray-600">{n.body}</p>}
                  <p className="mt-2 text-xs text-gray-400">
                    {new Date(n.created_at).toLocaleString()} · {n.type}
                  </p>
                </div>
                {!n.read_at && (
                  <button
                    onClick={() => markRead(n.id)}
                    disabled={busyId === n.id}
                    className="shrink-0 rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                  >
                    {busyId === n.id ? '...' : 'Mark read'}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
