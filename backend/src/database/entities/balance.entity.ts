import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum BalanceType {
  RAZER_GOLD_TRY = 'razer_gold_try',
  RAZER_GOLD_USD = 'razer_gold_usd',
  PAYPAL = 'paypal',
}

@Entity('balances')
export class Balance {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'enum',
    enum: BalanceType,
    unique: true,
  })
  type: BalanceType;

  @Column({ type: 'decimal', precision: 15, scale: 2, default: 0 })
  amount: number;

  @Column({ type: 'decimal', precision: 15, scale: 2, default: 0 })
  frozen: number; // Замороженные средства (в процессе)

  @Column({ nullable: true })
  currency: string; // TRY, USD

  @Column({ type: 'text', nullable: true })
  lastSyncAt: Date;

  @Column({ nullable: true })
  lastSyncError: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
