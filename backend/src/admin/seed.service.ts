import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { AdminAuthService } from './admin-auth.service';

@Injectable()
export class SeedService implements OnModuleInit {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    private readonly adminAuthService: AdminAuthService,
  ) {}

  /**
   * Создание первого админа при запуске
   */
  async onModuleInit() {
    // Создаём админа только если его нет
    const hasAdmins = await this.adminAuthService.hasAdmins();

    if (!hasAdmins) {
      this.logger.log('Creating default admin user...');

      // Используем пароль по умолчанию (изменить в продакшене!)
      const defaultPassword = process.env.ADMIN_DEFAULT_PASSWORD || 'admin123';

      const admin = await this.adminAuthService.createAdmin({
        username: 'admin',
        email: 'admin@bag1vbucks.local',
        password: defaultPassword,
      });

      this.logger.warn(`Default admin created:`);
      this.logger.warn(`  Username: admin`);
      this.logger.warn(`  Password: ${defaultPassword}`);
      this.logger.warn(`  Please change the password after first login!`);
    }
  }
}
