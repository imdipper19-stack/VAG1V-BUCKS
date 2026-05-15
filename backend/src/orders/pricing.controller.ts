import { Controller, Get, UseGuards } from '@nestjs/common';
import { PricingService } from './pricing.service';
import { AdminAuthGuard } from '../admin/admin-auth.guard';

@Controller('pricing')
export class PricingController {
  constructor(private readonly pricingService: PricingService) {}

  /**
   * GET /api/pricing
   * Публичный список пакетов V-Bucks (без себестоимости).
   * Используется лендингом и страницей покупателя.
   */
  @Get()
  list() {
    return {
      success: true,
      data: {
        packages: this.pricingService.listPublic(),
        currency: 'RUB',
      },
    };
  }

  /**
   * GET /api/pricing/admin
   * Полный прайс с себестоимостью, прибылью и маржой.
   * Только для авторизованных админов.
   */
  @Get('admin')
  @UseGuards(AdminAuthGuard)
  listAdmin() {
    return {
      success: true,
      data: {
        packages: this.pricingService.listWithProfit(),
        exchangeRate: this.pricingService.getExchangeRate(),
        currency: 'RUB',
      },
    };
  }
}
