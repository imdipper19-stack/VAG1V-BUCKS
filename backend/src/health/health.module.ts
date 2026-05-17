import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { HealthController } from './health.controller';
import { ORDER_QUEUE_NAME } from '../queue/constants';

@Module({
  imports: [BullModule.registerQueue({ name: ORDER_QUEUE_NAME })],
  controllers: [HealthController],
})
export class HealthModule {}
