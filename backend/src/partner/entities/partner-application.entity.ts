import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum PartnerApplicationPlatformType {
  TELEGRAM = 'telegram',
  VK = 'vk',
  TWITCH = 'twitch',
  YOUTUBE = 'youtube',
  TIKTOK = 'tiktok',
  OTHER = 'other',
}

export enum PartnerApplicationStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

@Entity('partner_applications')
export class PartnerApplication {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'display_name', type: 'varchar', length: 128 })
  displayName: string;

  @Column({
    name: 'platform_type',
    type: 'enum',
    enum: PartnerApplicationPlatformType,
    enumName: 'partner_applications_platform_type_enum',
  })
  platformType: PartnerApplicationPlatformType;

  @Column({ name: 'platform_url', type: 'varchar', length: 512 })
  platformUrl: string;

  @Column({ name: 'audience_size', type: 'varchar', length: 64 })
  audienceSize: string;

  @Column({ name: 'contact_tg', type: 'varchar', length: 64 })
  contactTg: string;

  @Column({ type: 'text' })
  description: string;

  @Column({
    type: 'enum',
    enum: PartnerApplicationStatus,
    enumName: 'partner_applications_status_enum',
    default: PartnerApplicationStatus.PENDING,
  })
  @Index()
  status: PartnerApplicationStatus;

  @Column({ name: 'reviewed_by', type: 'uuid', nullable: true })
  reviewedBy: string | null;

  @Column({ name: 'reviewed_at', type: 'timestamp', nullable: true })
  reviewedAt: Date | null;

  @Column({ name: 'partner_id', type: 'uuid', nullable: true })
  @Index()
  partnerId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  @Index()
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt: Date;
}
