import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { OrderProcessingService } from './order-processing.service';
import { ORDER_QUEUE_NAME } from './constants';

export interface ProcessOrderJobData {
  orderId: string;
}

const ORDER_CONCURRENCY = Math.max(1, parseInt(process.env.ORDER_CONCURRENCY || '3', 10));

@Processor(ORDER_QUEUE_NAME, { concurrency: ORDER_CONCURRENCY })
export class OrderProcessor extends WorkerHost {
  private readonly logger = new Logger(OrderProcessor.name);

  constructor(private readonly orderProcessingService: OrderProcessingService) {
    super();
    this.logger.log(`OrderProcessor started with concurrency=${ORDER_CONCURRENCY}`);
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
