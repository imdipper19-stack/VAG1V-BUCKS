import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { OrderProcessingService } from './order-processing.service';
import { ORDER_QUEUE_NAME } from './constants';

export interface ProcessOrderJobData {
  orderId: string;
}

@Processor(ORDER_QUEUE_NAME)
export class OrderProcessor extends WorkerHost {
  private readonly logger = new Logger(OrderProcessor.name);

  constructor(private readonly orderProcessingService: OrderProcessingService) {
    super();
  }

  async process(job: Job<ProcessOrderJobData>): Promise<void> {
    const { orderId } = job.data;

    this.logger.log(`Processing order: ${orderId}`);

    try {
      await job.updateProgress(10);
      await this.orderProcessingService.processOrder(orderId);
      await job.updateProgress(100);

      this.logger.log(`Order ${orderId} processed successfully`);
    } catch (error) {
      this.logger.error(`Failed to process order ${orderId}:`, error);
      throw error;
    }
  }
}
