import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { PricingService } from './pricing.service';
import { PricingController } from './pricing.controller';
import { Order, TimelineLogEntry } from '../database/entities';
import { AdminModule } from '../admin/admin.module';
import { QueueModule } from '../queue/queue.module';
import { PartnerModule } from '../partner/partner.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, TimelineLogEntry]),
    forwardRef(() => AdminModule), // нужен AdminAuthGuard для /pricing/admin
    forwardRef(() => QueueModule), // нужен OrderEventBus для SSE endpoint
    // Partner program — provides PromoCodeService for promo validation
    // at checkout (Requirement 9.2-9.6) and CommissionService for the
    // pending-commission stamp on order creation (Requirement 10.1).
    // forwardRef is defensive: today PartnerModule has no dep on
    // OrdersModule, but if future tasks add cross-references this keeps
    // module init order from breaking.
    forwardRef(() => PartnerModule),
  ],
  controllers: [OrdersController, PricingController],
  providers: [OrdersService, PricingService],
  exports: [OrdersService, PricingService, TypeOrmModule],
})
export class OrdersModule {}
