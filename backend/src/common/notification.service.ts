import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SettingsService } from '../settings/settings.service';
import axios from 'axios';

/**
 * Сервис Telegram-уведомлений.
 * Приоритет: БД (через админку) → .env (fallback)
 */
@Injectable()
export class NotificationService implements OnModuleInit {
  private readonly logger = new Logger(NotificationService.name);
  private botToken: string;
  private chatId: string;

  constructor(
    private configService: ConfigService,
    private settingsService: SettingsService,
  ) {
    this.botToken = this.configService.get('TELEGRAM_BOT_TOKEN', '');
    this.chatId = this.configService.get('TELEGRAM_CHAT_ID', '');
  }

  async onModuleInit() {
    // При старте загружаем конфиг из БД (если есть)
    await this.refreshConfigFromDB();
  }

  async refreshConfigFromDB(): Promise<void> {
    try {
      const config = await this.settingsService.getTelegramConfig();
      if (config?.botToken && config?.chatId && config?.enabled) {
        this.botToken = config.botToken;
        this.chatId = config.chatId;
        this.logger.log(`Telegram config loaded from DB (chatId: ${this.chatId})`);
      }
    } catch { /* ignore — use .env fallback */ }
  }

  /**
   * Обновляет конфиг из админки (вызывается при сохранении настроек).
   */
  setTelegramConfig(botToken: string, chatId: string): void {
    this.botToken = botToken || this.botToken;
    this.chatId = chatId || this.chatId;
    this.logger.log(`Telegram config updated (chatId: ${chatId})`);
  }

  async sendTelegram(message: string): Promise<boolean> {
    if (!this.botToken || !this.chatId) {
      this.logger.debug('Telegram not configured — skipping notification');
      return false;
    }

    try {
      await axios.post(
        `https://api.telegram.org/bot${this.botToken}/sendMessage`,
        {
          chat_id: this.chatId,
          text: message,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        },
        { timeout: 5000 },
      );
      return true;
    } catch (error: any) {
      this.logger.error(`Telegram notification failed: ${error.message}`);
      return false;
    }
  }

  async notifyNewOrder(orderId: string, vbucksAmount: number, priceTRY: number): Promise<void> {
    await this.sendTelegram(
      `🆕 <b>Новый заказ</b>\n📦 ID: <code>${orderId}</code>\n💎 V-Bucks: ${vbucksAmount.toLocaleString()}\n💰 Цена: ${priceTRY} TRY`,
    );
  }

  async notifyOrderCompleted(orderId: string, epicDisplayName: string, vbucksAmount: number): Promise<void> {
    await this.sendTelegram(
      `✅ <b>Заказ выполнен</b>\n📦 ID: <code>${orderId}</code>\n🎮 Аккаунт: ${epicDisplayName}\n💎 V-Bucks: ${vbucksAmount.toLocaleString()}`,
    );
  }

  async notifyOrderFailed(orderId: string, errorMessage: string): Promise<void> {
    await this.sendTelegram(
      `❌ <b>Ошибка заказа</b>\n📦 ID: <code>${orderId}</code>\n⚠️ Ошибка: ${errorMessage}`,
    );
  }

  async notifyPaymentReceived(orderId: string, amount: number, currency: string): Promise<void> {
    await this.sendTelegram(
      `💳 <b>Оплата получена</b>\n📦 ID: <code>${orderId}</code>\n💰 Сумма: ${amount} ${currency}`,
    );
  }

  async notifySystemAlert(message: string): Promise<void> {
    await this.sendTelegram(`🚨 <b>Системное уведомление</b>\n${message}`);
  }

  async notifyLowRazerBalance(username: string, balanceTRY: number): Promise<void> {
    await this.sendTelegram(
      `⚠️ <b>Низкий баланс Razer Gold</b>\n👤 Аккаунт: ${username}\n💰 Баланс: ${balanceTRY} TRY\nПополни баланс чтобы заказы продолжали обрабатываться.`,
    );
  }

  async notifyRazerCookiesExpired(username: string): Promise<void> {
    await this.sendTelegram(
      `🍪 <b>Куки Razer Gold истекли</b>\n👤 Аккаунт: ${username}\nЗайди в gold.razer.com, экспортируй куки и обнови через админку.`,
    );
  }

}
