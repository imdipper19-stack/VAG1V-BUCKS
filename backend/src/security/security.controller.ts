import {
  Controller, Get, Post, Put, Body, Param,
  HttpCode, HttpStatus, Req, BadRequestException,
} from '@nestjs/common';
import { Request } from 'express';
import { SecurityService } from './security.service';

@Controller('security')
export class SecurityController {
  constructor(private readonly securityService: SecurityService) {}

  @Get('activity-logs')
  async getActivityLogs() {
    const logs = await this.securityService.getActivityLogs(100);
    return { success: true, data: logs };
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @Body() body: { adminId: string; currentPassword: string; newPassword: string },
  ) {
    if (!body.adminId || !body.currentPassword || !body.newPassword) {
      throw new BadRequestException('adminId, currentPassword and newPassword are required');
    }
    await this.securityService.changePassword(body.adminId, body.currentPassword, body.newPassword);
    return { success: true, data: { message: 'Password changed successfully' } };
  }

  @Get('ip-whitelist')
  async getIPWhitelist() {
    const ips = await this.securityService.getIPWhitelist();
    return { success: true, data: { ips } };
  }

  @Put('ip-whitelist')
  @HttpCode(HttpStatus.OK)
  async setIPWhitelist(@Body() body: { ips: string[] }) {
    if (!Array.isArray(body.ips)) {
      throw new BadRequestException('ips must be an array');
    }
    await this.securityService.setIPWhitelist(body.ips);
    return { success: true, data: { message: 'IP whitelist updated' } };
  }

  @Get('sessions/:adminId')
  async getActiveSessions(@Param('adminId') adminId: string) {
    const sessions = await this.securityService.getActiveSessions(adminId);
    return { success: true, data: sessions };
  }

  @Post('sessions/:adminId/revoke-all')
  @HttpCode(HttpStatus.OK)
  async revokeAllSessions(@Param('adminId') adminId: string) {
    await this.securityService.revokeAllSessions(adminId);
    return { success: true, data: { message: 'All sessions revoked' } };
  }

  @Post('backup')
  @HttpCode(HttpStatus.OK)
  async createBackup() {
    const result = await this.securityService.createDatabaseBackup();
    return {
      success: true,
      data: {
        filename: result.filename,
        size: result.size,
        message: `Backup created: ${result.filename} (${(result.size / 1024).toFixed(1)} KB)`,
      },
    };
  }

  @Get('backups')
  async listBackups() {
    const backups = await this.securityService.listBackups();
    return { success: true, data: backups };
  }
}
