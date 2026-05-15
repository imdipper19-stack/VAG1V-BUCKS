import { Controller, Get, Post, Put, Delete, Body, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { RazerAccountService } from './razer-account.service';
import { EpicBrowserService } from '../epic/epic-browser.service';
import { RazerAccountStatus } from '../database/entities';

@Controller('razer-accounts')
export class RazerAccountController {
  constructor(
    private readonly razerAccountService: RazerAccountService,
    private readonly epicBrowserService: EpicBrowserService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createAccount(@Body() body: {
    username: string;
    password: string;
    email?: string;
    minBalanceThreshold?: number;
    totpSecret?: string;
  }) {
    const account = await this.razerAccountService.createAccount(body);
    return {
      success: true,
      data: account,
    };
  }

  @Get()
  async getAccounts() {
    const accounts = await this.razerAccountService.getAccounts();
    // Скрываем чувствительные данные
    const safe = accounts.map(a => ({
      ...a,
      password: '***',
      totpSecret: a.totpSecret ? '***configured***' : null,
    }));
    return { success: true, data: safe };
  }

  @Get('stats')
  async getAccountStats() {
    const stats = await this.razerAccountService.getAccountStats();
    return {
      success: true,
      data: stats,
    };
  }

  @Get('low-balance')
  async getLowBalanceAccounts() {
    const accounts = await this.razerAccountService.getLowBalanceAccounts();
    return {
      success: true,
      data: accounts,
    };
  }

  @Get(':id')
  async getAccount(@Param('id') id: string) {
    const account = await this.razerAccountService.getAccountById(id);
    if (!account) {
      return {
        success: false,
        error: 'Account not found',
      };
    }
    return {
      success: true,
      data: account,
    };
  }

  @Put(':id')
  async updateAccount(
    @Param('id') id: string,
    @Body() body: Partial<{
      username: string;
      password: string;
      email: string;
      balanceVbucks: number;
      balanceTRY: number;
      status: RazerAccountStatus;
      minBalanceThreshold: number;
      totpSecret: string;
      metadata: Record<string, any>;
    }>,
  ) {
    const account = await this.razerAccountService.updateAccount(id, body);
    if (!account) {
      return {
        success: false,
        error: 'Account not found',
      };
    }
    return {
      success: true,
      data: account,
    };
  }

  @Put(':id/balance')
  async updateBalance(@Param('id') id: string, @Body() body: { balance: number }) {
    await this.razerAccountService.updateBalance(id, body.balance);
    return {
      success: true,
      data: { message: 'Balance updated' },
    };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async deleteAccount(@Param('id') id: string) {
    await this.razerAccountService.deleteAccount(id);
    return {
      success: true,
      data: { message: 'Account deleted' },
    };
  }

  /**
   * Сохранить куки сессии Razer Gold для аккаунта
   * Куки можно экспортировать из браузера через расширение "EditThisCookie" или "Cookie-Editor"
   */
  @Put(':id/cookies')
  @HttpCode(HttpStatus.OK)
  async saveCookies(
    @Param('id') id: string,
    @Body() body: { cookies: string },
  ) {
    if (!body.cookies) {
      return { success: false, error: 'cookies field is required' };
    }

    // Валидируем что это валидный JSON
    try {
      const parsed = JSON.parse(body.cookies);
      if (!Array.isArray(parsed)) {
        return { success: false, error: 'cookies must be a JSON array' };
      }
    } catch {
      return { success: false, error: 'Invalid JSON format' };
    }

    const account = await this.razerAccountService.updateAccount(id, {
      sessionCookies: body.cookies,
    } as any);

    return {
      success: true,
      data: { message: 'Cookies saved successfully', id: account?.id },
    };
  }

  /**
   * Проверить валидность кук — открывает браузер и проверяет сессию.
   * Если куки протухли — пытается перелогиниться через email/password.
   * Автоматически парсит баланс TRY и сохраняет в БД.
   */
  @Post(':id/validate-cookies')
  @HttpCode(HttpStatus.OK)
  async validateCookies(@Param('id') id: string) {
    const account = await this.razerAccountService.getAccountById(id);
    if (!account) {
      return { success: false, error: 'Account not found' };
    }

    const cookies = (account as any).sessionCookies || '[]';

    const result = await this.epicBrowserService.validateRazerCookies(
      cookies,
      {
        email: account.email,
        password: account.password,
        totpSecret: (account as any).totpSecret,
      },
    );

    // Если получили обновлённые куки — сохраняем
    if (result.valid && result.refreshedCookies) {
      await this.razerAccountService.updateAccount(id, {
        sessionCookies: result.refreshedCookies,
      } as any);
    }

    // Если получили баланс TRY — сохраняем
    if (result.valid && result.balance !== undefined && result.currency === 'TRY') {
      await this.razerAccountService.updateBalanceTRY(id, result.balance);
    }

    return {
      success: true,
      data: result,
    };
  }
}
