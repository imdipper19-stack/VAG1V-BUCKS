import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { PricingService } from './pricing.service';
import { PricingController } from './pricing.controller';
import { Order, TimelineLogEntry } from '../database/entities';
import { AdminModule } from '../admin/admin.module';
import { QueueModule } from '../queue/queue.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, TimelineLogEntry]),
    forwardRef(() => AdminModule), // нужен AdminAuthGuard для /pricing/admin
    forwardRef(() => QueueModule), // нужен OrderEventBus для SSE endpoint
  ],
  controllers: [OrdersController, PricingController],
  providers: [OrdersService, PricingService],
  exports: [OrdersService, PricingService, TypeOrmModule],
})
export class OrdersModule {}
