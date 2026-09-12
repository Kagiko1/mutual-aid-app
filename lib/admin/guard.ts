import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export interface AdminSession {
  userId: string;
  email: string | null;
  fullName: string;
}

/** Throws redirect to /login unless the signed-in user has profiles.role === 'admin'. */
export async function requireAdmin(): Promise<AdminSession> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role, full_name, email')
    .eq('id', user.id)
    .single();

  const p = profile as { id: string; role: string; full_name: string; email: string | null } | null;
  if (!p || p.role !== 'admin') redirect('/login');

  return { userId: user.id, email: p.email ?? user.email ?? null, fullName: p.full_name || 'Admin' };
}
