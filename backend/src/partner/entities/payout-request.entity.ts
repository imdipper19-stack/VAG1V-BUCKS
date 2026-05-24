import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum PayoutRequestStatus {
  REQUESTED = 'requested',
  PROCESSING = 'processing',
  PAID = 'paid',
  REJECTED = 'rejected',
}

@Entity('payout_requests')
@Index('IDX_payout_requests_partner_status', ['partnerId', 'status'])
export class PayoutRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'partner_id' })
  @Index('IDX_payout_requests_partner_id')
  partnerId: string;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  amount: string;

  @Column({ type: 'text' })
  requisites: string;

  @Column({
    type: 'enum',
    enum: PayoutRequestStatus,
    enumName: 'payout_requests_status_enum',
    default: PayoutRequestStatus.REQUESTED,
  })
  @Index('IDX_payout_requests_status')
  status: PayoutRequestStatus;

  @Column({ type: 'text', name: 'rejection_reason', nullable: true })
  rejectionReason: string | null;

  @Column({ type: 'uuid', name: 'processed_by', nullable: true })
  processedBy: string | null;

  @Column({ type: 'timestamp', name: 'requested_at', default: () => 'NOW()' })
  requestedAt: Date;

  @Column({ type: 'timestamp', name: 'processing_at', nullable: true })
  processingAt: Date | null;

  @Column({ type: 'timestamp', name: 'paid_at', nullable: true })
  paidAt: Date | null;

  @Column({ type: 'timestamp', name: 'rejected_at', nullable: true })
  rejectedAt: Date | null;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;
}
