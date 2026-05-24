import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum PartnerStatusEnum {
  ACTIVE = 'active',
  DISABLED = 'disabled',
}

@Entity('partners')
export class Partner {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'username', type: 'varchar', length: 64, unique: true })
  username: string;

  @Column({ name: 'password_hash', type: 'varchar', length: 255 })
  passwordHash: string;

  @Column({ name: 'display_name', type: 'varchar', length: 128 })
  displayName: string;

  @Column({ name: 'contact_tg', type: 'varchar', length: 64 })
  contactTg: string;

  @Column({
    name: 'commission_rate',
    type: 'decimal',
    precision: 5,
    scale: 4,
    default: 0.1,
  })
  commissionRate: number;

  @Column({
    name: 'discount_rate',
    type: 'decimal',
    precision: 5,
    scale: 4,
    default: 0.05,
  })
  discountRate: number;

  @Column({
    name: 'status',
    type: 'enum',
    enum: PartnerStatusEnum,
    enumName: 'partners_status_enum',
    default: PartnerStatusEnum.ACTIVE,
  })
  @Index('IDX_partners_status')
  status: PartnerStatusEnum;

  @Column({
    name: 'invite_token',
    type: 'varchar',
    length: 128,
    unique: true,
    nullable: true,
  })
  inviteToken: string | null;

  @Column({ name: 'invite_token_used', type: 'boolean', default: false })
  inviteTokenUsed: boolean;

  @Column({ name: 'invite_token_expires_at', type: 'timestamp', nullable: true })
  inviteTokenExpiresAt: Date | null;

  // Plain UUID column — relation to PartnerApplication is intentionally not
  // declared here to avoid circular imports between partner.entity and
  // partner-application.entity. Services that need the application can load
  // it explicitly by id.
  @Column({ name: 'application_id', type: 'uuid', nullable: true })
  applicationId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt: Date;
}
