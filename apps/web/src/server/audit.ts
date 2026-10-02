/**
 * The admin audit log (docs/07): one append-only row per admin action, with
 * the reason the admin gave. Written in the same transaction as the change.
 * No Next.js imports, so database tests can use it.
 */
import { adminAuditLog, type Queryable } from '@etb/db';

export interface AuditEntry {
  adminId: string;
  action: string;
  targetType: string;
  targetId: string;
  before?: unknown;
  after?: unknown;
  reason: string;
}

/** One append-only audit row; call it in the same transaction as the change. */
export async function audit(db: Queryable, entry: AuditEntry): Promise<void> {
  await db.insert(adminAuditLog).values({
    adminId: entry.adminId,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    before: entry.before ?? null,
    after: entry.after ?? null,
    reason: entry.reason,
  });
}
