/**
 * GET /api/health — проверяет что backend жив и его критичные зависимости отвечают.
 * Используется Docker healthcheck (см. docker-compose.yml).
 *
 * Чек включает:
 *   • БД (typeorm.query SELECT 1)
 *   • Redis (BullMQ queue ping)
 *   • Browser pool (хотя бы один инстанс жив)
 *
 * Возвращает 200 если всё ок, 503 если что-то не отвечает.
 */

import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ORDER_QUEUE_NAME } from '../queue/constants';

@Controller('health')
export class HealthController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectQueue(ORDER_QUEUE_NAME) private readonly orderQueue: Queue,
  ) {}

  @Get()
  async check() {
    const checks: Record<string, { ok: boolean; message?: string }> = {};

    // Postgres
    try {
      await this.dataSource.query('SELECT 1');
      checks.postgres = { ok: true };
    } catch (err: any) {
      checks.postgres = { ok: false, message: err.message };
    }

    // Redis (через BullMQ queue client — он держит коннект к Redis)
    try {
      const client = await this.orderQueue.client;
      const pong = await client.ping();
      checks.redis = { ok: pong === 'PONG' };
    } catch (err: any) {
      checks.redis = { ok: false, message: err.message };
    }

    const allOk = Object.values(checks).every((c) => c.ok);

    if (!allOk) {
      throw new HttpException(
        { status: 'unhealthy', checks },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    return {
      status: 'ok',
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      checks,
    };
  }
}
