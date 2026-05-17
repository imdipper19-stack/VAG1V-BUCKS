import { Controller, Post, Body, HttpCode, HttpStatus, BadRequestException } from '@nestjs/common';
import { EpicApiPurchaseService, EpicPurchaseParams } from './epic-api-purchase.service';
import { EpicAuthService } from './epic-auth.service';

/**
 * Контроллер API-покупки + Epic OAuth device flow.
 *
 * POST /api/api-purchase/auth/start  — выдать user_code пользователю (для UI: "Введи JXQ7R8I на epicgames.com/activate")
 * POST /api/api-purchase/auth/poll   — поллить статус активации (фронт пуляет каждые ~5 сек)
 * POST /api/api-purchase/test        — запустить покупку с access_token
 */
@Controller('api-purchase')
export class ApiPurchaseController {
  constructor(
    private readonly purchaseService: EpicApiPurchaseService,
    private readonly authService: EpicAuthService,
  ) {}

  /**
   * Шаг 1: Получить device code и user code.
   * Возвращаем user_code (короткий, который юзер вбивает на сайте Epic)
   * + device_code (длинный, который шлём при поллинге; кладём в localStorage у фронта).
   */
  @Post('auth/start')
  @HttpCode(HttpStatus.OK)
  async authStart() {
    const result = await this.authService.startDeviceCodeFlow();
    return {
      success: true,
      deviceCode: result.deviceCode,
      userCode: result.userCode,
      verificationUri: result.verificationUri,
      verificationUriComplete: result.verificationUriComplete,
      expiresIn: result.expiresIn,
      pollIntervalMs: Math.max(result.interval * 1000, 3000),
    };
  }

  /**
   * Шаг 2: Поллить Epic с device_code до подтверждения.
   * Возвращаем status: 'pending' | 'authorized' | 'expired' | 'error'.
   */
  @Post('auth/poll')
  @HttpCode(HttpStatus.OK)
  async authPoll(@Body() body: { deviceCode: string }) {
    if (!body?.deviceCode) {
      throw new BadRequestException('deviceCode required');
    }
    const result = await this.authService.pollDeviceCode(body.deviceCode);
    return { success: true, ...result };
  }

  /**
   * Тестовый запуск API-покупки.
   * Body:
   * {
   *   "epicAccessToken": "...",
   *   "vbucksAmount": 800,
   *   "razerEmail": "...",
   *   "razerPassword": "...",
   *   "razerTotpSecret": "..."
   * }
   */
  @Post('test')
  @HttpCode(HttpStatus.OK)
  async testPurchase(@Body() body: {
    epicAccessToken: string;
    vbucksAmount: number;
    razerEmail: string;
    razerPassword: string;
    razerTotpSecret?: string;
  }) {
    if (!body.epicAccessToken || !body.razerEmail || !body.razerPassword) {
      return {
        success: false,
        error: 'epicAccessToken, razerEmail, razerPassword required',
      };
    }

    const result = await this.purchaseService.purchase({
      epicAccessToken: body.epicAccessToken,
      vbucksAmount: body.vbucksAmount || 800,
      razerCredentials: {
        email: body.razerEmail,
        password: body.razerPassword,
        totpSecret: body.razerTotpSecret,
      },
    });

    return {
      success: result.success,
      data: result,
    };
  }
}
