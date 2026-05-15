import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { OrderProcessor } from './order.processor';
import { OrderProcessingService } from './order-processing.service';
import { QueueService } from './queue.service';
import { OrderEventBus } from './order-event-bus.service';
import { EpicModule } from '../epic/epic.module';
import { OrdersModule } from '../orders/orders.module';
import { CommonModule } from '../common/common.module';
import { AuthModule } from '../auth/auth.module';
import { ProxyModule } from '../proxy/proxy.module';
import { RazerAccountModule } from '../razer/razer-account.module';
import { ORDER_QUEUE_NAME } from './constants';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get('REDIS_HOST', 'localhost'),
          port: configService.get<number>('REDIS_PORT', 6379),
        },
      }),
    }),
    BullModule.registerQueue({
      name: ORDER_QUEUE_NAME,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: 100,
        removeOnFail: 1000,
      },
    }),
    OrdersModule,
    EpicModule,
    CommonModule,
    ProxyModule,
    RazerAccountModule,
    forwardRef(() => AuthModule),
  ],
  providers: [OrderProcessor, OrderProcessingService, QueueService, OrderEventBus],
  exports: [BullModule, QueueService, OrderEventBus],
})
export class QueueModule {}
