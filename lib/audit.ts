/** Audit-log writer. Pass a service-role (admin) client so inserts bypass RLS. */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface AuditInput {
  /** Profile id of the actor; null for system/cron actions. */
  actorId?: string | null;
  action: string;
  entity?: string | null;
  entityId?: string | null;
  details?: Record<string, unknown>;
  /** Tenant scope — stored on the audit row. */
  orgId?: string | null;
}

export async function logAudit(admin: SupabaseClient, input: AuditInput): Promise<void> {
  const { error } = await admin.from('audit_log').insert({
    org_id: input.orgId ?? null,
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
