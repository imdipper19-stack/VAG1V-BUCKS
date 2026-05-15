import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Settings } from '../database/entities';

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    @InjectRepository(Settings)
    private settingsRepository: Repository<Settings>,
  ) {}

  async getSetting(key: string): Promise<Record<string, any> | null> {
    const setting = await this.settingsRepository.findOne({ where: { key } });
    return setting ? setting.value : null;
  }

  async setSetting(key: string, value: Record<string, any>, description: string): Promise<Settings> {
    let setting = await this.settingsRepository.findOne({ where: { key } });
    
    if (setting) {
      setting.value = value;
      return this.settingsRepository.save(setting);
    }
    
    setting = this.settingsRepository.create({ key, value, description });
    return this.settingsRepository.save(setting);
  }

  async getAllSettings(): Promise<Settings[]> {
    return this.settingsRepository.find({ order: { createdAt: 'DESC' } });
  }

  async deleteSetting(key: string): Promise<void> {
    await this.settingsRepository.delete({ key });
  }

  async getExchangeRate(): Promise<number> {
    const setting = await this.getSetting('exchange_rate');
    return setting?.rate || 1.63;
  }

  async setExchangeRate(rate: number): Promise<void> {
    await this.setSetting('exchange_rate', { rate }, 'Курс валют (TRY к RUB)');
  }

  async getOrderLimits(): Promise<{ maxDaily: number; maxPerUser: number }> {
    const setting = await this.getSetting('order_limits');
    return (setting as { maxDaily: number; maxPerUser: number }) || { maxDaily: 100, maxPerUser: 5 };
  }

  async setOrderLimits(limits: { maxDaily: number; maxPerUser: number }): Promise<void> {
    await this.setSetting('order_limits', limits, 'Лимиты на заказы');
  }

  async getTelegramConfig(): Promise<{ botToken: string; chatId: string; enabled: boolean }> {
    const setting = await this.getSetting('telegram');
    return (setting as { botToken: string; chatId: string; enabled: boolean }) || { botToken: '', chatId: '', enabled: false };
  }

  async setTelegramConfig(config: { botToken: string; chatId: string; enabled: boolean }): Promise<void> {
    await this.setSetting('telegram', config, 'Telegram уведомления');
  }
}
