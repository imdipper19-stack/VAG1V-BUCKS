import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OrdersService } from '../orders/orders.service';
import { OrderStatusEnum, LogLevel } from '../database/entities';

@Injectable()
export class OrderExpirationService {
  private readonly logger = new Logger(OrderExpirationService.name);

  constructor(private readonly ordersService: OrdersService) {}

  /**
   * Каждые 5 минут отмечает просроченные заказы как FAILED.
   * Использует индексированный поиск по статусу + expiresAt вместо загрузки всех заказов в память.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async handleExpiredOrders() {
    this.logger.debug('Checking for expired orders...');

    try {
      const expired = await this.ordersService.findExpiredOrders();

      if (expired.length === 0) return;

      for (const order of expired) {
        await this.ordersService.updateStatus(order.id, OrderStatusEnum.FAILED, {
          errorMessage: 'Order expired',
        });

        await this.ordersService.addTimelineLogDirect(
          order.id,
          '[system]',
          'Order expired automatically',
          LogLevel.WARNING,
        );

        this.logger.log(`Order expired: ${order.orderId}`);
      }

      this.logger.log(`Expired ${expired.length} order(s)`);
    } catch (error) {
      this.logger.error('Failed to check expired orders:', error);
    }
  }
}
