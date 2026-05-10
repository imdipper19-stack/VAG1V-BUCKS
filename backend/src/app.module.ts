import { Module } from '@nestjs/common';
import { OrdersModule } from './orders/orders.module';
import { AuthModule } from './auth/auth.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { PaymentsModule } from './payments/payments.module';

@Module({
  imports: [
    OrdersModule,
    AuthModule,
    WebhooksModule,
    PaymentsModule,
  ],
})
export class AppModule {}
