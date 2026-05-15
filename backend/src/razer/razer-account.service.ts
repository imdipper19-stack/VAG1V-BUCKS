import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { RazerAccount, RazerAccountStatus, RazerAccountTrustLevel } from '../database/entities';

// Cooldown после появления капчи — 4 часа
const CAPTCHA_COOLDOWN_MS = 4 * 60 * 60 * 1000;

// Порог для повышения trust level
const SUCCESSES_FOR_READY = 5;
const SUCCESSES_FOR_TRUSTED = 20;

@Injectable()
export class RazerAccountService {
  private readonly logger = new Logger(RazerAccountService.name);

  constructor(
    @InjectRepository(RazerAccount)
    private razerAccountRepository: Repository<RazerAccount>,
  ) {}

  async createAccount(data: {
    username: string;
    password: string;
    email?: string;
    minBalanceThreshold?: number;
    totpSecret?: string;
  }): Promise<RazerAccount> {
    const account = this.razerAccountRepository.create(data);
    return this.razerAccountRepository.save(account);
  }

  async getAccounts(): Promise<RazerAccount[]> {
    return this.razerAccountRepository.find({ order: { createdAt: 'DESC' } });
  }

  async getAccountById(id: string): Promise<RazerAccount | null> {
    return this.razerAccountRepository.findOne({ where: { id } });
  }

  async updateAccount(id: string, data: Partial<RazerAccount>): Promise<RazerAccount | null> {
    await this.razerAccountRepository.update(id, data);
    return this.getAccountById(id);
  }

  async updateBalance(id: string, balance: number): Promise<void> {
    await this.razerAccountRepository.update(id, { balanceVbucks: balance });
  }

  async updateBalanceTRY(id: string, balanceTRY: number): Promise<void> {
    const updates: Partial<RazerAccount> = { balanceTRY };

    // Если баланс обновлён и он достаточный — автоматически ставим ACTIVE
    if (balanceTRY > 0) {
      const account = await this.getAccountById(id);
      if (account && (account.status === RazerAccountStatus.LOW_BALANCE || account.status === RazerAccountStatus.INACTIVE)) {
        updates.status = RazerAccountStatus.ACTIVE;
        this.logger.log(`Account ${account.username} auto-activated (balance updated to ${balanceTRY} TRY)`);
      }
    }

    await this.razerAccountRepository.update(id, updates);
  }

  async deleteAccount(id: string): Promise<void> {
    await this.razerAccountRepository.delete(id);
  }

  /**
   * Выбирает лучший доступный аккаунт для обработки заказа.
   *
   * Приоритет:
   * 1. TRUSTED аккаунты (меньше капчи)
   * 2. READY аккаунты
   * 3. WARMING аккаунты (если нет лучших)
   *
   * Аккаунт подходит если:
   * - Статус ACTIVE
   * - Не на cooldown
   * - Есть либо cookies, либо email+password (бот сам залогинится)
   * - Баланс TRY ≥ requiredTRY (если 0 — пропускаем чтобы бот сам обновил)
   */
  async selectAccountForPurchase(requiredTRY: number): Promise<RazerAccount | null> {
    const now = Date.now();

    const accounts = await this.razerAccountRepository.find({
      where: { status: RazerAccountStatus.ACTIVE },
      order: { trustLevel: 'DESC', consecutiveSuccesses: 'DESC', lastUsedAt: 'ASC' },
    });

    for (const account of accounts) {
      // Пропускаем аккаунты на cooldown
      if (account.cooldownUntil && account.cooldownUntil > now) {
        const remainingMin = Math.ceil((account.cooldownUntil - now) / 60_000);
        this.logger.debug(`Account ${account.username} on cooldown for ${remainingMin} more minutes`);
        continue;
      }

      // Аккаунт подходит если есть либо куки, либо email+password
      const hasAuth = !!account.sessionCookies || (!!account.email && !!account.password);
      if (!hasAuth) {
        this.logger.debug(`Account ${account.username} has no cookies and no email/password — skipping`);
        continue;
      }

      // Если баланс известен и его не хватает — пропускаем
      // Если balanceTRY === 0, считаем что баланс не проверялся, всё равно даём шанс
      // (бот обновит баланс перед заказом через validateRazerCookies)
      const balance = Number(account.balanceTRY);
      if (balance > 0 && balance < requiredTRY) {
        this.logger.debug(`Account ${account.username} balance ${balance} TRY < required ${requiredTRY} TRY`);
        continue;
      }

      return account;
    }

    return null;
  }

  /**
   * Помечает успешное использование аккаунта.
   * Повышает trust level при достижении порогов.
   */
  async markSuccess(id: string, spentTRY: number): Promise<void> {
    const account = await this.getAccountById(id);
    if (!account) return;

    const newConsecutive = account.consecutiveSuccesses + 1;
    const newSuccessful = account.ordersSuccessful + 1;
    const newProcessed = account.ordersProcessed + 1;
    const newBalanceTRY = Math.max(0, Number(account.balanceTRY) - spentTRY);

    // Повышаем trust level
    let newTrustLevel = account.trustLevel;
    if (newConsecutive >= SUCCESSES_FOR_TRUSTED && account.trustLevel !== RazerAccountTrustLevel.TRUSTED) {
      newTrustLevel = RazerAccountTrustLevel.TRUSTED;
      this.logger.log(`Account ${account.username} promoted to TRUSTED level`);
    } else if (newConsecutive >= SUCCESSES_FOR_READY && account.trustLevel === RazerAccountTrustLevel.WARMING) {
      newTrustLevel = RazerAccountTrustLevel.READY;
      this.logger.log(`Account ${account.username} promoted to READY level`);
    }

    // Проверяем низкий баланс
    let newStatus = account.status;
    if (newBalanceTRY < account.minBalanceThreshold && account.minBalanceThreshold > 0) {
      newStatus = RazerAccountStatus.LOW_BALANCE;
      this.logger.warn(`Account ${account.username} balance low: ${newBalanceTRY} TRY`);
    }

    await this.razerAccountRepository.update(id, {
      ordersProcessed: newProcessed,
      ordersSuccessful: newSuccessful,
      consecutiveSuccesses: newConsecutive,
      lastUsedAt: Date.now(),
      balanceTRY: newBalanceTRY,
      trustLevel: newTrustLevel,
      status: newStatus,
    });
  }

  /**
   * Помечает появление капчи на аккаунте.
   * Ставит аккаунт на cooldown на 4 часа.
   * Сбрасывает consecutiveSuccesses.
   */
  async markCaptchaEvent(id: string): Promise<void> {
    const account = await this.getAccountById(id);
    if (!account) return;

    const cooldownUntil = Date.now() + CAPTCHA_COOLDOWN_MS;

    this.logger.warn(
      `Account ${account.username} got captcha — setting cooldown for 4h. ` +
      `Total captchas: ${account.captchaCount + 1}`,
    );

    await this.razerAccountRepository.update(id, {
      captchaCount: account.captchaCount + 1,
      lastCaptchaAt: Date.now(),
      consecutiveSuccesses: 0,  // сбрасываем streak
      cooldownUntil,
      status: RazerAccountStatus.COOLDOWN,
    });

    // Через 4 часа автоматически снимаем cooldown
    setTimeout(async () => {
      const current = await this.getAccountById(id);
      if (current && current.status === RazerAccountStatus.COOLDOWN) {
        await this.razerAccountRepository.update(id, {
          status: RazerAccountStatus.ACTIVE,
          cooldownUntil: 0,
        });
        this.logger.log(`Account ${account.username} cooldown lifted`);
      }
    }, CAPTCHA_COOLDOWN_MS);
  }

  /**
   * Помечает неудачное использование аккаунта (не связанное с капчей).
   */
  async markFailure(id: string): Promise<void> {
    const account = await this.getAccountById(id);
    if (!account) return;

    await this.razerAccountRepository.update(id, {
      ordersProcessed: account.ordersProcessed + 1,
      ordersFailed: account.ordersFailed + 1,
      consecutiveSuccesses: 0,
      lastUsedAt: Date.now(),
    });
  }

  async getLowBalanceAccounts(threshold = 1000): Promise<RazerAccount[]> {
    return this.razerAccountRepository
      .createQueryBuilder('account')
      .where('account.balanceTRY < :threshold', { threshold })
      .andWhere('account.status = :status', { status: RazerAccountStatus.ACTIVE })
      .getMany();
  }

  async getAccountStats(): Promise<{
    total: number;
    active: number;
    lowBalance: number;
    cooldown: number;
    totalBalanceTRY: number;
    successRate: number;
    trustedCount: number;
  }> {
    const accounts = await this.getAccounts();

    const active = accounts.filter((a) => a.status === RazerAccountStatus.ACTIVE).length;
    const lowBalance = accounts.filter((a) => a.status === RazerAccountStatus.LOW_BALANCE).length;
    const cooldown = accounts.filter((a) => a.status === RazerAccountStatus.COOLDOWN).length;
    const trustedCount = accounts.filter((a) => a.trustLevel === RazerAccountTrustLevel.TRUSTED).length;
    const totalBalanceTRY = accounts.reduce((sum, a) => sum + Number(a.balanceTRY), 0);

    const totalOrders = accounts.reduce((sum, a) => sum + a.ordersProcessed, 0);
    const successfulOrders = accounts.reduce((sum, a) => sum + a.ordersSuccessful, 0);
    const successRate = totalOrders > 0 ? Math.round((successfulOrders / totalOrders) * 100) : 0;

    return { total: accounts.length, active, lowBalance, cooldown, totalBalanceTRY, successRate, trustedCount };
  }
}
