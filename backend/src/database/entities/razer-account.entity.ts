import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum RazerAccountStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  LOW_BALANCE = 'low_balance',
  COOLDOWN = 'cooldown',   // временно не используется (после капчи)
  BANNED = 'banned',       // заблокирован Epic/Razer
}

/**
 * Уровень доверия аккаунта — влияет на частоту появления капчи.
 * NEW → WARMING → READY → TRUSTED
 */
export enum RazerAccountTrustLevel {
  NEW = 'new',           // только создан, не прогрет
  WARMING = 'warming',   // в процессе прогрева
  READY = 'ready',       // готов к работе
  TRUSTED = 'trusted',   // прогретый, капча редко
}

@Entity('razer_accounts')
export class RazerAccount {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  username: string;

  @Column()
  password: string;

  @Column({ nullable: true })
  email: string;

  /** Баланс в V-Bucks (для учёта, не реальный баланс Razer Gold) */
  @Column({ default: 0 })
  balanceVbucks: number;

  /** Реальный баланс Razer Gold в TRY */
  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  balanceTRY: number;

  @Column({
    type: 'enum',
    enum: RazerAccountStatus,
    default: RazerAccountStatus.ACTIVE,
  })
  status: RazerAccountStatus;

  @Column({
    type: 'enum',
    enum: RazerAccountTrustLevel,
    default: RazerAccountTrustLevel.NEW,
  })
  trustLevel: RazerAccountTrustLevel;

  /** Общее количество обработанных заказов */
  @Column({ default: 0 })
  ordersProcessed: number;

  /** Успешных заказов */
  @Column({ default: 0 })
  ordersSuccessful: number;

  /** Неудачных заказов */
  @Column({ default: 0 })
  ordersFailed: number;

  /** Подряд успешных заказов без капчи (для повышения trust level) */
  @Column({ default: 0 })
  consecutiveSuccesses: number;

  /** Сколько раз появлялась капча на этом аккаунте */
  @Column({ default: 0 })
  captchaCount: number;

  /** Timestamp последнего появления капчи */
  @Column({ type: 'bigint', default: 0 })
  lastCaptchaAt: number;

  /** Timestamp последнего использования */
  @Column({ type: 'bigint', default: 0 })
  lastUsedAt: number;

  /** Timestamp до которого аккаунт на cooldown (не использовать) */
  @Column({ type: 'bigint', default: 0 })
  cooldownUntil: number;

  /** Минимальный порог баланса для алертов */
  @Column({ default: 0 })
  minBalanceThreshold: number;

  /** Куки сессии Razer Gold (JSON массив из браузера) */
  @Column({ type: 'text', nullable: true })
  sessionCookies: string;

  /**
   * TOTP secret для 2FA (Razer Premium требует 2FA).
   * Бот генерирует 6-значные коды через otplib используя этот secret.
   * Получается в админке Razer при подключении 2FA — кнопка "Show secret key" / "Can't scan QR?"
   */
  @Column({ type: 'varchar', length: 255, nullable: true })
  totpSecret: string;

  /** Дополнительные метаданные */
  @Column({ type: 'json', nullable: true })
  metadata: Record<string, any>;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
