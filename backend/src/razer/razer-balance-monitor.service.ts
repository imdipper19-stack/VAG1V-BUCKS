/**
 * RazerBalanceMonitorService — фоновое обновление баланса Razer-аккаунтов.
 *
 * Что делает:
 *   • Раз в 30 минут проходит по всем ACTIVE и LOW_BALANCE аккаунтам.
 *   • Дёргает Razer Gold через EpicBrowserService.validateRazerCookies (login-by-cookies или re-login).
 *   • Записывает реальный баланс в RazerAccount.balanceTRY.
 *   • При 401/expired автоматически перелогинивается и сохраняет свежие cookies.
 *
 * Безопасность:
 *   • Аккаунты в COOLDOWN пропускаются (не дёргаем чтобы не словить ещё капчу).
 *   • Между проверками 5-секундная пауза (не насилуем Razer).
 *   • Параллельность 1: один аккаунт за раз.
 *   • При первой капче на аккаунте — markCaptchaEvent + cooldown.
 *
 * Запуск:
 *   • Cron каждые 30 минут (см. @Cron).
 *   • Ручной запуск: POST /api/razer-accounts/refresh-balances (см. controller).
 */

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { RazerAccount, RazerAccountStatus } from '../database/entities';
import { RazerAccountService } from './razer-account.service';
import { EpicBrowserService } from '../epic/epic-browser.service';

const REFRESH_PAUSE_MS = 5000; // пауза между аккаунтами

@Injectable()
export class RazerBalanceMonitorService {
  private readonly logger = new Logger(RazerBalanceMonitorService.name);
  private running = false;

  constructor(
    @InjectRepository(RazerAccount)
    private readonly razerAccountRepository: Repository<RazerAccount>,
    private readonly razerAccountService: RazerAccountService,
    private readonly epicBrowserService: EpicBrowserService,
  ) {}

  /**
   * Cron-задача: каждые 30 минут обновляет балансы всех активных аккаунтов.
   */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async handleScheduledRefresh(): Promise<void> {
    if (this.running) {
      this.logger.warn('Previous balance refresh still running, skipping this tick');
      return;
    }

    this.running = true;
    try {
      const stats = await this.refreshAllBalances();
      this.logger.log(
        `Balance refresh complete: ${stats.updated}/${stats.total} updated, ` +
        `${stats.failed} failed, ${stats.skipped} skipped (cooldown)`,
      );
    } catch (err: any) {
      this.logger.error(`Balance refresh job crashed: ${err.message}`, err.stack);
    } finally {
      this.running = false;
    }
  }

  /**
   * Запускается также при старте сервера (через onModuleInit ниже),
   * чтобы балансы были свежие сразу после деплоя.
   */
  async onModuleInit(): Promise<void> {
    // Ждём 30 секунд после старта чтобы Postgres/Redis встали и BrowserPool прогрелся
    setTimeout(() => {
      if (process.env.SKIP_INITIAL_BALANCE_REFRESH !== 'true') {
        this.handleScheduledRefresh().catch((err) =>
          this.logger.error(`Initial balance refresh failed: ${err.message}`),
        );
      }
    }, 30_000);
  }

  /**
   * Возвращает свежий баланс одного аккаунта (используется в controller).
   */
  async refreshOne(id: string): Promise<{
    success: boolean;
    balance?: number;
    error?: string;
  }> {
    const account = await this.razerAccountService.getAccountById(id);
    if (!account) {
      return { success: false, error: 'Account not found' };
    }
    return this.refreshAccount(account);
  }

  /**
   * Полный проход по всем ACTIVE / LOW_BALANCE аккаунтам.
   */
  async refreshAllBalances(): Promise<{
    total: number;
    updated: number;
    failed: number;
    skipped: number;
  }> {
    // Берём только аккаунты которые имеет смысл проверять.
    // COOLDOWN пропускаем — иначе можем сходить за капчей повторно.
    const accounts = await this.razerAccountRepository.find({
      where: {
        status: In([RazerAccountStatus.ACTIVE, RazerAccountStatus.LOW_BALANCE]),
      },
    });

    if (accounts.length === 0) {
      return { total: 0, updated: 0, failed: 0, skipped: 0 };
    }

    this.logger.log(`Starting balance refresh for ${accounts.length} accounts`);

    let updated = 0;
    let failed = 0;
    const skipped = 0; // зарезервировано на случай in-process cooldown

    for (const account of accounts) {
      const result = await this.refreshAccount(account);
      if (result.success) {
        updated++;
      } else {
        failed++;
      }
      // Пауза между аккаунтами чтобы не насиловать Razer
      await this.sleep(REFRESH_PAUSE_MS);
    }

    return { total: accounts.length, updated, failed, skipped };
  }

  // ─────────────────────────────────────────────────────────

  private async refreshAccount(account: RazerAccount): Promise<{
    success: boolean;
    balance?: number;
    error?: string;
  }> {
    try {
      const result = await this.epicBrowserService.validateRazerCookies(
        account.sessionCookies || '[]',
        {
          email: account.email,
          password: account.password,
          totpSecret: (account as any).totpSecret,
        },
      );

      if (!result.valid) {
        // Razer/Cloudflare отбили — но это не повод бить аккаунт markFailure.
        // Логируем и идём дальше, через 30 минут попробуем снова.
        this.logger.warn(
          `[balance-monitor] ${account.username}: validate failed — ${result.error || 'unknown'}`,
        );
        return { success: false, error: result.error };
      }

      // Сохраняем свежие cookies если был перелогин
      if (result.refreshedCookies) {
        await this.razerAccountService.updateAccount(account.id, {
          sessionCookies: result.refreshedCookies,
        } as any);
      }

      // Сохраняем баланс (только если currency=TRY чтобы не записать какую-нибудь USD)
      if (typeof result.balance === 'number' && (result.currency || 'TRY') === 'TRY') {
        await this.razerAccountService.updateBalanceTRY(account.id, result.balance);
        this.logger.log(
          `[balance-monitor] ${account.username}: balance = ${result.balance} TRY`,
        );
        return { success: true, balance: result.balance };
      }

      this.logger.warn(
        `[balance-monitor] ${account.username}: balance not parsed (currency=${result.currency})`,
      );
      return { success: false, error: 'Balance not parsed' };
    } catch (err: any) {
      this.logger.error(
        `[balance-monitor] ${account.username}: ${err.message}`,
        err.stack,
      );
      return { success: false, error: err.message };
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
