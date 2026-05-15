import { Module } from '@nestjs/common';
import { EpicBrowserService } from './epic-browser.service';
import { RazerGoldService } from './razer-gold.service';
import { CaptchaModule } from '../captcha/captcha.module';

@Module({
  imports: [CaptchaModule],
  providers: [EpicBrowserService, RazerGoldService],
  exports: [EpicBrowserService, RazerGoldService],
})
export class EpicModule {}
