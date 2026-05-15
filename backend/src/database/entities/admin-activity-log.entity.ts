import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
} from 'typeorm';

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
}

@Entity('admin_activity_logs')
export class AdminActivityLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  adminId: string;

  @Column()
  adminUsername: string;

  @Column({
    type: 'enum',
    enum: AdminActivityType,
  })
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
