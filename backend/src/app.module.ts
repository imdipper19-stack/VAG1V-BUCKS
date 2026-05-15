import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { AdminModule } from './admin/admin.module';
import { OrdersModule } from './orders/orders.module';
import { AuthModule } from './auth/auth.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { PaymentsModule } from './payments/payments.module';
import { QueueModule } from './queue/queue.module';
import { CommonModule } from './common/common.module';
import { ProxyModule } from './proxy/proxy.module';
import { RazerAccountModule } from './razer/razer-account.module';
import { SettingsModule } from './settings/settings.module';
import { SecurityModule } from './security/security.module';
import { CaptchaModule } from './captcha/captcha.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    DatabaseModule,
    CommonModule,
    AdminModule,
    OrdersModule,
    AuthModule,
    WebhooksModule,
    PaymentsModule,
    QueueModule,
    ProxyModule,
    RazerAccountModule,
    SettingsModule,
    SecurityModule,
    CaptchaModule,
  ],
})
export class AppModule {}
