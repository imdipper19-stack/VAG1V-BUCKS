import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum CommissionEntryStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  CANCELLED = 'cancelled',
}

@Entity('commission_entries')
@Index('IDX_commission_entries_partner_status', ['partnerId', 'status'])
export class CommissionEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'order_id', unique: true })
  orderId: string;

  @Column({ name: 'partner_id' })
  @Index('IDX_commission_entries_partner_id')
  partnerId: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, name: 'amount' })
  amount: number;

  @Column({
    type: 'enum',
    enum: CommissionEntryStatus,
    enumName: 'commission_entries_status_enum',
    default: CommissionEntryStatus.PENDING,
  })
  @Index('IDX_commission_entries_status')
  status: CommissionEntryStatus;

  @Column({ type: 'timestamp', name: 'approved_at', nullable: true })
  approvedAt: Date | null;

  @Column({ type: 'timestamp', name: 'cancelled_at', nullable: true })
  cancelledAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
