import {
  Controller,
  Post,
  Get,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { AdminAuthService } from './admin-auth.service';
import { AdminAuthGuard } from './admin-auth.guard';
import { CurrentAdmin } from './current-admin.decorator';
import { Admin } from './admin.entity';
import { AuthRateLimitGuard } from '../common/rate-limit.guard';

@Controller('admin/auth')
export class AdminAuthController {
  constructor(private adminAuthService: AdminAuthService) {}

  /**
   * POST /api/admin/auth/login
   * Вход администратора (rate limited: 5 attempts/min)
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthRateLimitGuard)
  async login(@Body() body: { username: string; password: string }, @Req() req: Request) {
    const ip = req.ip || req.socket?.remoteAddress;

    const result = await this.adminAuthService.login(body.username, body.password, ip);

    if (!result.success) {
      throw new UnauthorizedException(result.error);
    }

    return {
      success: true,
      data: result,
    };
  }

  /**
   * POST /api/admin/auth/register
   * Регистрация первого админа (только если нет админов)
   */
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(AuthRateLimitGuard)
  async register(@Body() body: { username: string; email: string; password: string }) {
    // Проверяем, есть ли уже админы
    const hasAdmins = await this.adminAuthService.hasAdmins();

    if (hasAdmins) {
      throw new UnauthorizedException('Registration is disabled');
    }

    try {
      const admin = await this.adminAuthService.createAdmin({
        username: body.username,
        email: body.email,
        password: body.password,
      });

      // Сразу логиним после регистрации
      const loginResult = await this.adminAuthService.login(body.username, body.password);

      return {
        success: true,
        data: {
          admin: {
            id: admin.id,
            username: admin.username,
            email: admin.email,
            role: admin.role,
          },
          token: loginResult.token,
        },
      };
    } catch (error) {
      throw new UnauthorizedException('Registration failed');
    }
  }

  /**
   * GET /api/admin/auth/me
   * Получение информации о текущем админе
   */
  @Get('me')
  @UseGuards(AdminAuthGuard)
  async me(@CurrentAdmin() admin: Admin) {
    return {
      success: true,
      data: {
        id: admin.id,
        username: admin.username,
        email: admin.email,
        role: admin.role,
        lastLoginAt: admin.lastLoginAt,
      },
    };
  }

  /**
   * POST /api/admin/auth/verify
   * Проверка токена
   */
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  async verify(@Body() body: { token: string }) {
    const admin = await this.adminAuthService.validateToken(body.token);

    if (!admin) {
      throw new UnauthorizedException('Invalid token');
    }

    return {
      success: true,
      data: {
        valid: true,
        admin: {
          id: admin.id,
          username: admin.username,
          role: admin.role,
        },
      },
    };
  }

  /**
   * POST /api/admin/auth/seed
   * Создание админа (только для разработки)
   */
  @Post('seed')
  @HttpCode(HttpStatus.CREATED)
  async seed(@Body() body: { username?: string; email?: string; password?: string }) {
    const username = body.username || 'admin';
    const email = body.email || 'admin@bag1vbucks.local';
    const password = body.password || 'admin123';

    try {
      const admin = await this.adminAuthService.createAdmin({
        username,
        email,
        password,
      });

      return {
        success: true,
        data: {
          message: 'Admin created successfully',
          admin: {
            id: admin.id,
            username: admin.username,
            email: admin.email,
          },
          credentials: {
            username,
            password,
          },
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error.message || 'Failed to create admin',
      };
    }
  }
}
