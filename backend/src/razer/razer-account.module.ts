import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RazerAccountController } from './razer-account.controller';
import { RazerAccountService } from './razer-account.service';
import { RazerBalanceMonitorService } from './razer-balance-monitor.service';
import { RazerAccount } from '../database/entities';
import { EpicModule } from '../epic/epic.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([RazerAccount]),
    EpicModule,
  ],
  controllers: [RazerAccountController],
  providers: [RazerAccountService, RazerBalanceMonitorService],
  exports: [RazerAccountService, RazerBalanceMonitorService],
})
export class RazerAccountModule {}
