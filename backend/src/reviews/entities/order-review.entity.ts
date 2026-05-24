import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * Moderation lifecycle of an order review.
 *
 * The string values (`pending` / `approved` / `rejected`) MUST match
 * the PostgreSQL ENUM `order_reviews_status_enum` created in migration
 * `1735100000000-AddOrderReviewsTable.ts`.
 */
export enum ReviewStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

/**
 * `order_reviews` table — one moderated review per completed order.
 *
 * Schema and index names mirror the migration so TypeORM does not try
 * to re-create them. The `enumName` ties the `status` column to the
 * existing PG type rather than letting TypeORM generate a new one.
 *
 * `moderated_by` is kept as a plain UUID column (no relation) — admins
 * live in a separate module and the FK is enforced at the DB level
 * (`ON DELETE SET NULL`) by the migration.
 */
@Entity('order_reviews')
@Index('IDX_order_reviews_status_created_at', ['status', 'createdAt'])
@Index('IDX_order_reviews_ip_created_at', ['ipAddress', 'createdAt'])
export class OrderReview {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'order_id', unique: true })
  orderId: string;

  @Column({ type: 'varchar', length: 64 })
  nickname: string;

  @Column({ type: 'smallint' })
  stars: number;

  @Column({ type: 'text' })
  text: string;

  @Column({
    type: 'enum',
    enum: ReviewStatus,
    enumName: 'order_reviews_status_enum',
    default: ReviewStatus.PENDING,
  })
  @Index('IDX_order_reviews_status')
  status: ReviewStatus;

  @Column({ type: 'text', name: 'rejection_reason', nullable: true })
  rejectionReason: string | null;

  @Column({ type: 'uuid', name: 'moderated_by', nullable: true })
  moderatedBy: string | null;

  @Column({ type: 'timestamp', name: 'approved_at', nullable: true })
  approvedAt: Date | null;

  @Column({ type: 'timestamp', name: 'rejected_at', nullable: true })
  rejectedAt: Date | null;

  @Column({ type: 'inet', name: 'ip_address', nullable: true })
  ipAddress: string | null;

  @Column({ type: 'text', name: 'user_agent', nullable: true })
  userAgent: string | null;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;
}
