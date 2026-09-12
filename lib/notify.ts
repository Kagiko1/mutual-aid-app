/**
 * Member notifications: in-app notification row + best-effort SMS + email stub.
 * Pass a service-role (admin) client so inserts bypass RLS.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendSms } from './sms';

export interface NotifyInput {
  memberId: string;
  title: string;
  body?: string;
  type?: string;
  /** Tenant scope — stored on the notification row. */
  orgId?: string | null;
}

export async function notifyMember(admin: SupabaseClient, input: NotifyInput): Promise<void> {
  const { error } = await admin.from('notifications').insert({
    org_id: input.orgId ?? null,
    member_id: input.memberId,
    title: input.title,
    body: input.body ?? null,
    type: input.type ?? 'info',
  });
  if (error) console.error('[notify] notification insert failed:', error.message);

  // Best-effort SMS to the member's phone number.
  try {
    const { data: profile } = await admin
      .from('profiles')
      .select('phone')
      .eq('id', input.memberId)
      .single();
    const phone = (profile as { phone?: string | null } | null)?.phone;
    if (phone) {
      const text = input.body ? `${input.title}: ${input.body}` : input.title;
      await sendSms(phone, text);
    }
  } catch (e) {
    console.error('[notify] sms send failed:', e);
  }

  // Email is not wired up yet — log as a stub so the intent is visible.
  console.log(`[email stub] to member ${input.memberId}: ${input.title}`);
}

export interface BroadcastInput {
  title: string;
  body?: string;
  type?: string;
  /** Tenant scope — only members of this org are notified. */
  orgId?: string | null;
}

/** Notify every member (role='member'). Returns the number of members notified. */
export async function notifyAllMembers(admin: SupabaseClient, input: BroadcastInput): Promise<number> {
  let query = admin.from('profiles').select('id').eq('role', 'member');
  if (input.orgId) query = query.eq('org_id', input.orgId);
  const { data, error } = await query;
  if (error) {
    console.error('[notify] broadcast member lookup failed:', error.message);
    return 0;
  }
  const members = (data ?? []) as { id: string }[];
  for (const m of members) {
    await notifyMember(admin, { memberId: m.id, title: input.title, body: input.body, type: input.type ?? 'announcement', orgId: input.orgId ?? null });
  }
  return members.length;
}
