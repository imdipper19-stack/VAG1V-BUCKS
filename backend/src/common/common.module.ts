import { Module, forwardRef } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { OrderExpirationService } from './order-expiration.service';
import { NotificationService } from './notification.service';
import { OrdersModule } from '../orders/orders.module';
import { SettingsModule } from '../settings/settings.module';
import { RateLimitGuard, AuthRateLimitGuard, ApiRateLimitGuard } from './rate-limit.guard';
import { LoggingInterceptor } from './logging.interceptor';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    forwardRef(() => OrdersModule),
    SettingsModule,
  ],
  providers: [
    OrderExpirationService,
    NotificationService,
    {
      provide: RateLimitGuard,
      useValue: new RateLimitGuard(100, 60000),
    },
    {
      provide: AuthRateLimitGuard,
      useClass: AuthRateLimitGuard,
    },
    {
      provide: ApiRateLimitGuard,
      useClass: ApiRateLimitGuard,
    },
    LoggingInterceptor,
  ],
  exports: [
    OrderExpirationService,
    NotificationService,
    RateLimitGuard,
    AuthRateLimitGuard,
    ApiRateLimitGuard,
    LoggingInterceptor,
  ],
})
export class CommonModule {}
