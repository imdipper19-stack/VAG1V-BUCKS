import { Module } from '@nestjs/common';
import { EpicApiPurchaseService } from './epic-api-purchase.service';
import { EpicAuthService } from './epic-auth.service';
import { ApiPurchaseController } from './api-purchase.controller';
import { CaptchaModule } from '../captcha/captcha.module';
import { BrowserPool } from './browser-pool.service';

@Module({
  imports: [CaptchaModule],
  providers: [EpicApiPurchaseService, EpicAuthService, BrowserPool],
  controllers: [ApiPurchaseController],
  exports: [EpicApiPurchaseService, EpicAuthService, BrowserPool],
})
export class ApiPurchaseModule {}
