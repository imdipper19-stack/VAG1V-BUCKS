import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
} from 'typeorm';

/**
 * Catalogue of admin activity types written to `admin_activity_logs.action`.
 *
 * --------------------------------------------------------------------
 * Why this is no longer a Postgres ENUM
 * --------------------------------------------------------------------
 * The `admin_activity_logs` table is created via TypeORM `synchronize: true`
 * (see `database.module.ts`). Adding new values to a Postgres ENUM cannot
 * be done by `synchronize` — PG requires `ALTER TYPE … ADD VALUE` and
 * TypeORM does not emit it. Each new entry would block app startup.
 *
 * To stay forward-compatible with future actions (e.g. `review.approve`,
 * `review.reject`) without a migration per entry, the column is widened
 * to `varchar(64)` (see migration `1735100001000-WidenAdminActivityLogAction`).
 * The `AdminActivityType` union below remains the single source of truth
 * for type-safety in TypeScript; the database simply stores the string.
 */
export enum AdminActivityType {
  LOGIN = 'login',
  LOGOUT = 'logout',
  PASSWORD_CHANGE = 'password_change',
  ORDER_RETRY = 'order_retry',
  PROXY_ADD = 'proxy_add',
  PROXY_DELETE = 'proxy_delete',
  RAZER_ADD = 'razer_add',
  RAZER_DELETE = 'razer_delete',
  SETTINGS_UPDATE = 'settings_update',
  REVIEW_APPROVE = 'review.approve',
  REVIEW_REJECT = 'review.reject',
}

@Entity('admin_activity_logs')
export class AdminActivityLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  adminId: string;

  @Column()
  adminUsername: string;

  /**
   * Stored as `varchar(64)` (no DB-level enum) — see class comment above.
   * The TypeScript type stays `AdminActivityType` so callers benefit from
   * exhaustive checks at the application layer.
   */
  @Column({ type: 'varchar', length: 64 })
  action: AdminActivityType;

  @Column({ type: 'json', nullable: true })
  metadata: Record<string, any>;

  @Column()
  ipAddress: string;

  @Column({ nullable: true })
  userAgent: string;

  @CreateDateColumn()
  createdAt: Date;
}
