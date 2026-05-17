import { Module, forwardRef } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OrdersModule } from '../orders/orders.module';
import { QueueModule } from '../queue/queue.module';
import { ApiPurchaseModule } from '../api-purchase/api-purchase.module';

@Module({
  imports: [
    forwardRef(() => OrdersModule),
    forwardRef(() => QueueModule),
    ApiPurchaseModule,
  ],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
