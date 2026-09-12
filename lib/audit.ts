/** Audit-log writer. Pass a service-role (admin) client so inserts bypass RLS. */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface AuditInput {
  /** Profile id of the actor; null for system/cron actions. */
  actorId?: string | null;
  action: string;
  entity?: string | null;
  entityId?: string | null;
  details?: Record<string, unknown>;
}

export async function logAudit(admin: SupabaseClient, input: AuditInput): Promise<void> {
  const { error } = await admin.from('audit_log').insert({
    actor_id: input.actorId ?? null,
    action: input.action,
    entity: input.entity ?? null,
    entity_id: input.entityId ?? null,
    details: input.details ?? {},
  });
  if (error) {
    // Audit must never break the primary flow; log loudly instead.
    console.error('[audit] insert failed:', error.message);
  }
}
