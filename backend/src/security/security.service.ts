import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import * as path from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Admin } from '../admin/admin.entity';
import { AdminActivityLog, AdminActivityType, Settings } from '../database/entities';

const execAsync = promisify(exec);

// In-memory session store (keyed by adminId → Set of token hashes)
const revokedTokens = new Set<string>();

@Injectable()
export class SecurityService {
  private readonly logger = new Logger(SecurityService.name);

  constructor(
    @InjectRepository(Admin)
    private adminRepository: Repository<Admin>,
    @InjectRepository(AdminActivityLog)
    private activityLogRepository: Repository<AdminActivityLog>,
    @InjectRepository(Settings)
    private settingsRepository: Repository<Settings>,
    private configService: ConfigService,
  ) {}

  async logActivity(
    adminId: string,
    adminUsername: string,
    action: AdminActivityType,
    ipAddress: string,
    userAgent?: string,
    metadata?: Record<string, any>,
  ): Promise<void> {
    const log = this.activityLogRepository.create({
      adminId,
      adminUsername,
      action,
      ipAddress,
      userAgent,
      metadata,
    });
    await this.activityLogRepository.save(log);
  }

  async getActivityLogs(limit: number = 50): Promise<AdminActivityLog[]> {
    return this.activityLogRepository.find({
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  /**
   * Смена пароля с правильной проверкой через scrypt
   */
  async changePassword(
    adminId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const admin = await this.adminRepository.findOne({ where: { id: adminId } });

    if (!admin) {
      throw new BadRequestException('Admin not found');
    }

    // Проверяем текущий пароль
    const isValid = this.verifyPassword(currentPassword, admin.passwordHash);
    if (!isValid) {
      throw new BadRequestException('Current password is incorrect');
    }

    if (newPassword.length < 8) {
      throw new BadRequestException('New password must be at least 8 characters');
    }

    // Хешируем новый пароль через scrypt
    const newHash = this.hashPassword(newPassword);
    await this.adminRepository.update(adminId, { passwordHash: newHash });
    this.logger.log(`Password changed for admin ${adminId}`);
  }

  private verifyPassword(password: string, storedHash: string): boolean {
    if (storedHash.includes(':')) {
      const [salt, hash] = storedHash.split(':');
      const derivedHash = crypto.scryptSync(password, salt, 64).toString('hex');
      try {
        return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(derivedHash, 'hex'));
      } catch {
        return false;
      }
    }
    // Legacy SHA-256
    const sha256 = crypto.createHash('sha256').update(password).digest('hex');
    return sha256 === storedHash;
  }

  private hashPassword(password: string): string {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return `${salt}:${hash}`;
  }

  /**
   * IP Whitelist — хранится в таблице settings
   */
  async getIPWhitelist(): Promise<string[]> {
    const setting = await this.settingsRepository.findOne({ where: { key: 'ip_whitelist' } });
    return (setting?.value as { ips: string[] })?.ips || [];
  }

  async setIPWhitelist(ips: string[]): Promise<void> {
    const validIps = ips
      .map(ip => ip.trim())
      .filter(ip => ip.length > 0 && /^[\d.:/a-fA-F]+$/.test(ip));

    let setting = await this.settingsRepository.findOne({ where: { key: 'ip_whitelist' } });
    if (setting) {
      setting.value = { ips: validIps };
      await this.settingsRepository.save(setting);
    } else {
      setting = this.settingsRepository.create({
        key: 'ip_whitelist',
        value: { ips: validIps },
        description: 'IP whitelist for admin access',
      });
      await this.settingsRepository.save(setting);
    }
    this.logger.log(`IP whitelist updated: ${validIps.join(', ') || 'empty (all allowed)'}`);
  }

  async isIPWhitelisted(ip: string): Promise<boolean> {
    const whitelist = await this.getIPWhitelist();
    if (whitelist.length === 0) return true;
    return whitelist.includes(ip);
  }

  /**
   * Сессии — хранятся как JWT токены в БД (поле lastLoginAt + lastLoginIp)
   * Отзыв — через in-memory blacklist (достаточно для одного сервера)
   */
  async getActiveSessions(adminId: string): Promise<Array<{
    id: string;
    ip: string;
    lastLoginAt: string;
    username: string;
  }>> {
    const admins = await this.adminRepository.find({
      where: adminId === 'all' ? {} : { id: adminId },
      select: ['id', 'username', 'lastLoginAt', 'lastLoginIp'],
    });

    return admins
      .filter(a => a.lastLoginAt)
      .map(a => ({
        id: a.id,
        ip: a.lastLoginIp || 'unknown',
        lastLoginAt: a.lastLoginAt ? new Date(a.lastLoginAt).toISOString() : '',
        username: a.username,
      }));
  }

  async revokeAllSessions(adminId: string): Promise<void> {
    // Сбрасываем lastLoginAt чтобы сессия считалась недействительной
    await this.adminRepository.update(adminId, {
      lastLoginAt: null as any,
    });
    this.logger.log(`All sessions revoked for admin ${adminId}`);
  }

  /**
   * Бэкап БД через pg_dump
   */
  async createDatabaseBackup(): Promise<{ filename: string; size: number; path: string }> {
    const dbHost = this.configService.get('DB_HOST', 'localhost');
    const dbPort = this.configService.get('DB_PORT', '5432');
    const dbUser = this.configService.get('DB_USERNAME', 'postgres');
    const dbName = this.configService.get('DB_DATABASE', 'bag1vbucks');
    const dbPassword = this.configService.get('DB_PASSWORD', 'postgres');

    const backupDir = path.join(process.cwd(), 'backups');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `backup-${timestamp}.sql`;
    const filePath = path.join(backupDir, filename);

    const env = { ...process.env, PGPASSWORD: dbPassword };

    try {
      await execAsync(
        `pg_dump -h ${dbHost} -p ${dbPort} -U ${dbUser} -d ${dbName} -f "${filePath}"`,
        { env },
      );

      const stats = fs.statSync(filePath);
      this.logger.log(`Database backup created: ${filename} (${stats.size} bytes)`);

      return { filename, size: stats.size, path: filePath };
    } catch (error: any) {
      this.logger.error(`Database backup failed: ${error.message}`);
      throw new BadRequestException(`Backup failed: ${error.message}`);
    }
  }

  async listBackups(): Promise<Array<{ filename: string; size: number; createdAt: string }>> {
    const backupDir = path.join(process.cwd(), 'backups');
    if (!fs.existsSync(backupDir)) return [];

    const files = fs.readdirSync(backupDir)
      .filter(f => f.endsWith('.sql'))
      .map(f => {
        const stats = fs.statSync(path.join(backupDir, f));
        return { filename: f, size: stats.size, createdAt: stats.birthtime.toISOString() };
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return files;
  }
}
