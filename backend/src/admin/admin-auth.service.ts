import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { Admin, AdminRole } from './admin.entity';

export interface LoginResult {
  success: boolean;
  token?: string;
  admin?: {
    id: string;
    username: string;
    email: string;
    role: AdminRole;
  };
  error?: string;
}

export interface TokenPayload {
  sub: string;
  username: string;
  role: AdminRole;
  iat: number;
  exp: number;
}

@Injectable()
export class AdminAuthService {
  private readonly logger = new Logger(AdminAuthService.name);
  private readonly jwtSecret: string;
  private readonly jwtExpiresInMs: number;

  constructor(
    @InjectRepository(Admin)
    private readonly adminRepository: Repository<Admin>,
    private readonly configService: ConfigService,
  ) {
    this.jwtSecret = this.configService.get('JWT_SECRET', this.generateSecret());
    // Parse JWT_EXPIRES_IN (e.g. '24h', '7d', '30m')
    const expiresIn = this.configService.get('JWT_EXPIRES_IN', '24h');
    this.jwtExpiresInMs = this.parseExpiresIn(expiresIn);
  }

  /**
   * Parse expiry string like '24h', '7d', '30m' to milliseconds
   */
  private parseExpiresIn(value: string): number {
    const match = value.match(/^(\d+)(s|m|h|d)$/);
    if (!match) return 24 * 60 * 60 * 1000; // default 24h

    const num = parseInt(match[1]);
    switch (match[2]) {
      case 's': return num * 1000;
      case 'm': return num * 60 * 1000;
      case 'h': return num * 60 * 60 * 1000;
      case 'd': return num * 24 * 60 * 60 * 1000;
      default: return 24 * 60 * 60 * 1000;
    }
  }

  /**
   * Генерация случайного секрета для JWT
   */
  private generateSecret(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Хеширование пароля с солью через scrypt
   * Формат: salt:hash (hex)
   */
  hashPassword(password: string): string {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return `${salt}:${hash}`;
  }

  /**
   * Проверка пароля
   * Поддерживает как новый формат (salt:hash) так и legacy SHA-256
   */
  private verifyPassword(password: string, storedHash: string): boolean {
    // Новый формат: salt:hash
    if (storedHash.includes(':')) {
      const [salt, hash] = storedHash.split(':');
      const derivedHash = crypto.scryptSync(password, salt, 64).toString('hex');
      return crypto.timingSafeEqual(
        Buffer.from(hash, 'hex'),
        Buffer.from(derivedHash, 'hex'),
      );
    }

    // Legacy: plain SHA-256 (для обратной совместимости с seed)
    const sha256Hash = crypto.createHash('sha256').update(password).digest('hex');
    return sha256Hash === storedHash;
  }

  /**
   * Генерация JWT токена с iat и exp
   */
  private generateToken(admin: Admin): string {
    const now = Math.floor(Date.now() / 1000);
    const exp = now + Math.floor(this.jwtExpiresInMs / 1000);

    const payload: TokenPayload = {
      sub: admin.id,
      username: admin.username,
      role: admin.role,
      iat: now,
      exp,
    };

    // Base64url encode (URL-safe)
    const header = this.base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const body = this.base64url(JSON.stringify(payload));

    const signature = crypto
      .createHmac('sha256', this.jwtSecret)
      .update(`${header}.${body}`)
      .digest('base64url');

    return `${header}.${body}.${signature}`;
  }

  /**
   * Base64url encode
   */
  private base64url(str: string): string {
    return Buffer.from(str).toString('base64url');
  }

  /**
   * Верификация JWT токена
   */
  verifyToken(token: string): TokenPayload | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;

      const [header, body, signature] = parts;

      // Проверяем подпись
      const expectedSignature = crypto
        .createHmac('sha256', this.jwtSecret)
        .update(`${header}.${body}`)
        .digest('base64url');

      // Timing-safe comparison
      if (signature.length !== expectedSignature.length) return null;
      const sigBuf = Buffer.from(signature);
      const expectedBuf = Buffer.from(expectedSignature);
      if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) {
        return null;
      }

      const payload = JSON.parse(
        Buffer.from(body, 'base64url').toString(),
      ) as TokenPayload;

      // Проверяем срок действия
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp && payload.exp < now) {
        this.logger.debug(`Token expired for user ${payload.username}`);
        return null;
      }

      // Проверяем iat (не из будущего)
      if (payload.iat && payload.iat > now + 60) {
        return null;
      }

      return payload;
    } catch {
      return null;
    }
  }

  /**
   * Вход администратора
   */
  async login(username: string, password: string, ip?: string): Promise<LoginResult> {
    try {
      // Находим админа
      const admin = await this.adminRepository.findOne({
        where: { username },
      });

      if (!admin) {
        this.logger.warn(`Login failed: user not found - ${username} from ${ip}`);
        return { success: false, error: 'Invalid credentials' };
      }

      // Проверяем активность
      if (!admin.isActive) {
        this.logger.warn(`Login failed: account disabled - ${username}`);
        return { success: false, error: 'Account is disabled' };
      }

      // Проверяем блокировку
      if (admin.lockedUntil && new Date(admin.lockedUntil) > new Date()) {
        const remainingMinutes = Math.ceil(
          (new Date(admin.lockedUntil).getTime() - Date.now()) / 60000
        );
        this.logger.warn(`Login failed: account locked - ${username}`);
        return {
          success: false,
          error: `Account locked. Try again in ${remainingMinutes} minutes.`,
        };
      }

      // Проверяем пароль
      if (!this.verifyPassword(password, admin.passwordHash)) {
        // Увеличиваем счётчик неудачных попыток
        admin.failedLoginAttempts += 1;

        // Блокируем после 5 неудачных попыток на 15 минут
        if (admin.failedLoginAttempts >= 5) {
          admin.lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
          this.logger.warn(`Account locked due to too many failed attempts: ${username}`);
        }

        await this.adminRepository.save(admin);
        this.logger.warn(`Login failed: invalid password - ${username}`);
        return { success: false, error: 'Invalid credentials' };
      }

      // Успешный вход
      // Обновляем хеш на новый формат если используется legacy SHA-256
      const updateData: any = {
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
      };

      if (ip) {
        updateData.lastLoginIp = ip;
      }

      // Если пароль в legacy формате — перехешируем в scrypt
      if (!admin.passwordHash.includes(':')) {
        updateData.passwordHash = this.hashPassword(password);
        this.logger.log(`Migrated password hash to scrypt for user: ${username}`);
      }

      await this.adminRepository.update(admin.id, updateData);

      const token = this.generateToken(admin);

      this.logger.log(`Admin logged in: ${username} from ${ip}`);

      return {
        success: true,
        token,
        admin: {
          id: admin.id,
          username: admin.username,
          email: admin.email,
          role: admin.role,
        },
      };
    } catch (error) {
      this.logger.error(`Login error: ${error}`);
      return { success: false, error: 'Login failed' };
    }
  }

  /**
   * Проверка токена (для Guard)
   */
  async validateToken(token: string): Promise<Admin | null> {
    const payload = this.verifyToken(token);
    if (!payload) return null;

    return this.adminRepository.findOne({
      where: { id: payload.sub, isActive: true },
    });
  }

  /**
   * Создание администратора
   */
  async createAdmin(data: {
    username: string;
    email: string;
    password: string;
    role?: AdminRole;
  }): Promise<Admin> {
    const admin = this.adminRepository.create({
      username: data.username,
      email: data.email,
      passwordHash: this.hashPassword(data.password),
      role: data.role || AdminRole.ADMIN,
    });

    return this.adminRepository.save(admin);
  }

  /**
   * Проверка существования админа
   */
  async hasAdmins(): Promise<boolean> {
    const count = await this.adminRepository.count();
    return count > 0;
  }
}
