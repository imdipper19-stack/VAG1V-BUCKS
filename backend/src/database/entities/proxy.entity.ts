import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum ProxyType {
  HTTP = 'HTTP',
  HTTPS = 'HTTPS',
  SOCKS5 = 'SOCKS5',
}

export enum ProxyStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  FAILED = 'failed',
}

@Entity('proxies')
export class Proxy {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  host: string;

  @Column()
  port: number;

  @Column({ nullable: true })
  username: string;

  @Column({ nullable: true })
  password: string;

  @Column({
    type: 'enum',
    enum: ProxyType,
    default: ProxyType.HTTP,
  })
  type: ProxyType;

  @Column({
    type: 'enum',
    enum: ProxyStatus,
    default: ProxyStatus.ACTIVE,
  })
  status: ProxyStatus;

  @Column({ default: 0 })
  successCount: number;

  @Column({ default: 0 })
  failureCount: number;

  @Column({ type: 'bigint', default: 0 })
  lastUsedAt: number;

  @Column({ type: 'bigint', default: 0 })
  lastTestedAt: number;

  @Column({ nullable: true })
  latency: number;

  @Column({ default: false })
  isDefault: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  getConnectionString(): string {
    if (this.username && this.password) {
      return `${this.type.toLowerCase()}://${this.username}:${this.password}@${this.host}:${this.port}`;
    }
    return `${this.type.toLowerCase()}://${this.host}:${this.port}`;
  }
}
