import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { TimelineLogEntry } from './timeline-log.entity';

export enum OrderStatusEnum {
  PENDING = 'pending',
  AWAITING_AUTH = 'awaiting_auth',
  AUTH_COMPLETED = 'auth_completed',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  REFUNDED = 'refunded',
}

export enum PaymentStatusEnum {
  PENDING = 'pending',
  PAID = 'paid',
  FAILED = 'failed',
  REFUNDED = 'refunded',
}

@Entity('orders')
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  @Index()
  orderId: string; // VB-2024-XXXXXX

  @Column({ unique: true })
  @Index()
  shortUrlSlug: string;

  // V-Bucks info
  @Column({ type: 'int' })
  vbucksAmount: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  priceTRY: number;

  @Column({ default: 'TRY' })
  currency: string;

  // Order region (for Epic Games)
  @Column({ default: 'TR' })
  region: string;

  // ----------------------------------------------------------------
  // Partner program fields (added by partner-program spec, Task 1.2)
  //
  // All five columns are nullable: orders placed without a promo code
  // simply leave them NULL. When a partner code IS applied at checkout,
  // we snapshot the partner's rates onto the order so subsequent rate
  // changes by the admin do NOT retroactively alter past orders
  // (Requirement 7.3, 16.1, 16.2).
  // ----------------------------------------------------------------
  @Column({ type: 'uuid', name: 'partner_id', nullable: true })
  @Index()
  partnerId: string | null;

  @Column({ type: 'varchar', length: 16, name: 'promo_code_snapshot', nullable: true })
  promoCodeSnapshot: string | null;

  @Column({
    type: 'decimal',
    precision: 5,
    scale: 4,
    name: 'discount_rate_snapshot',
    nullable: true,
  })
  discountRateSnapshot: number | null;

  @Column({
    type: 'decimal',
    precision: 5,
    scale: 4,
    name: 'commission_rate_snapshot',
    nullable: true,
  })
  commissionRateSnapshot: number | null;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    name: 'discount_amount',
    nullable: true,
  })
  discountAmount: number | null;

  // Status
  @Column({
    type: 'enum',
    enum: OrderStatusEnum,
    default: OrderStatusEnum.PENDING,
  })
  @Index()
  status: OrderStatusEnum;

  @Column({
    type: 'enum',
    enum: PaymentStatusEnum,
    default: PaymentStatusEnum.PENDING,
  })
  paymentStatus: PaymentStatusEnum;

  // Epic Games Auth
  @Column({ nullable: true })
  epicDeviceCode: string;

  @Column({ nullable: true })
  epicUserCode: string;

  @Column({ type: 'timestamp', nullable: true })
  epicDeviceCodeExpiresAt: Date;

  @Column({ nullable: true })
  epicAccessToken: string;

  @Column({ nullable: true })
  epicRefreshToken: string;

  @Column({ nullable: true })
  epicExchangeCode: string;

  @Column({ nullable: true })
  epicAccountId: string;

  @Column({ nullable: true })
  epicDisplayName: string;

  // Payment info
  @Column({ nullable: true })
  invoiceId: string;

  @Column({ nullable: true })
  transactionId: string;

  // Razer Gold info
  @Column({ nullable: true })
  razerOrderId: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  balanceBefore: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  balanceAfter: number;

  // Webhook
  @Column({ nullable: true })
  webhookUrl: string;

  @Column({ type: 'text', nullable: true })
  webhookResponse: string;

  // Screenshots (base64 or URL)
  @Column({ type: 'text', nullable: true })
  screenshotUrl: string;

  // Error handling
  @Column({ type: 'text', nullable: true })
  errorMessage: string;

  @Column({ default: 0 })
  retryCount: number;

  // Meta
  @Column({ nullable: true })
  sellerId: string;

  @Column({ nullable: true })
  buyerIp: string;

  @Column({ nullable: true })
  userAgent: string;

  // Timestamps
  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  @Index()
  completedAt: Date;

  @Column({ type: 'timestamp' })
  @Index()
  expiresAt: Date;

  // Timeline logs
  @OneToMany(() => TimelineLogEntry, (log) => log.order, {
    cascade: true,
    eager: true,
  })
  timelineLogs: TimelineLogEntry[];
}
