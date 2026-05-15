import { Controller, Get, Post, Put, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { SettingsService } from './settings.service';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  async getAllSettings() {
    const settings = await this.settingsService.getAllSettings();
    return {
      success: true,
      data: settings,
    };
  }

  @Get('exchange-rate')
  async getExchangeRate() {
    const rate = await this.settingsService.getExchangeRate();
    return {
      success: true,
      data: { rate },
    };
  }

  @Put('exchange-rate')
  @HttpCode(HttpStatus.OK)
  async setExchangeRate(@Body() body: { rate: number }) {
    await this.settingsService.setExchangeRate(body.rate);
    return {
      success: true,
      data: { message: 'Exchange rate updated' },
    };
  }

  @Get('order-limits')
  async getOrderLimits() {
    const limits = await this.settingsService.getOrderLimits();
    return {
      success: true,
      data: limits,
    };
  }

  @Put('order-limits')
  @HttpCode(HttpStatus.OK)
  async setOrderLimits(@Body() body: { maxDaily: number; maxPerUser: number }) {
    await this.settingsService.setOrderLimits(body);
    return {
      success: true,
      data: { message: 'Order limits updated' },
    };
  }

  @Get('telegram')
  async getTelegramConfig() {
    const config = await this.settingsService.getTelegramConfig();
    return {
      success: true,
      data: config,
    };
  }

  @Put('telegram')
  @HttpCode(HttpStatus.OK)
  async setTelegramConfig(@Body() body: { botToken: string; chatId: string; enabled: boolean }) {
    await this.settingsService.setTelegramConfig(body);
    return {
      success: true,
      data: { message: 'Telegram config updated' },
    };
  }
}
