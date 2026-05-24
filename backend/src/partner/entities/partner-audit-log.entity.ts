import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * Who performed the action recorded in `partner_audit_log`.
 *
 * - `admin`  — an authenticated admin user (actor_id references admins.id)
 * - `system` — automated process (actor_id is NULL)
 *
 * Backed by the PostgreSQL enum type `partner_audit_log_actor_type_enum`
 * (see migration `1735000000000-AddPartnerTables`).
 */
export enum PartnerAuditActorType {
  ADMIN = 'admin',
  SYSTEM = 'system',
}

/**
 * Audit-trail entry for any change to a partner-program entity
 * (partner, application, payout request, commission entry).
 *
 * Maps the `partner_audit_log` table from design.md §1.1.
 *
 * Notes:
 *   - `entity_type` is a free-form discriminator, not a FK — values:
 *     'partner' | 'application' | 'payout_request' | 'commission_entry'.
 *   - `actor_id` is intentionally NOT a FK: it may reference admins.id
 *     when actor_type='admin', or be NULL when actor_type='system'.
 *   - `old_value` / `new_value` capture the relevant subset of the entity
 *     before and after the change as JSON.
 *   - Only `created_at` is tracked — audit rows are append-only, never updated.
 */
@Entity('partner_audit_log')
@Index('IDX_partner_audit_log_entity', ['entityType', 'entityId'])
@Index('IDX_partner_audit_log_created_at', ['createdAt'])
export class PartnerAuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 64, name: 'entity_type' })
  entityType: string;

  @Column({ type: 'uuid', name: 'entity_id' })
  entityId: string;

  @Column({ type: 'varchar', length: 128, name: 'action' })
  action: string;

  @Column({
    type: 'enum',
    enum: PartnerAuditActorType,
    enumName: 'partner_audit_log_actor_type_enum',
    name: 'actor_type',
  })
  actorType: PartnerAuditActorType;

  @Column({ type: 'uuid', name: 'actor_id', nullable: true })
  actorId: string | null;

  @Column({ type: 'jsonb', name: 'old_value', nullable: true })
  oldValue: Record<string, unknown> | null;

  @Column({ type: 'jsonb', name: 'new_value', nullable: true })
  newValue: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;
}
