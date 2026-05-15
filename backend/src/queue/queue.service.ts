import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ORDER_QUEUE_NAME } from './constants';

export interface OrderJobData {
  orderId: string;
}

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);

  constructor(
    @InjectQueue(ORDER_QUEUE_NAME)
    private readonly orderQueue: Queue,
  ) {}

  /**
   * Добавить заказ в очередь обработки
   */
  async queueOrderForProcessing(orderId: string): Promise<void> {
    const job = await this.orderQueue.add(
      'process-order',
      { orderId } as OrderJobData,
      {
        jobId: `order-${orderId}`,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: 100,
        removeOnFail: 1000,
      },
    );

    this.logger.log(`Order ${orderId} queued for processing, jobId: ${job.id}`);
  }

  /**
   * Получить статус джобы
   */
  async getJobStatus(orderId: string): Promise<{
    state: string;
    progress: number;
    attemptsMade: number;
  } | null> {
    const job = await this.orderQueue.getJob(`order-${orderId}`);

    if (!job) {
      return null;
    }

    const state = await job.getState();
    const progress = job.progress as number || 0;
    const attemptsMade = job.attemptsMade || 0;

    return { state, progress, attemptsMade };
  }

  /**
   * Удалить джобу из очереди
   */
  async removeJob(orderId: string): Promise<void> {
    const job = await this.orderQueue.getJob(`order-${orderId}`);
    if (job) {
      await job.remove();
      this.logger.log(`Job removed for order: ${orderId}`);
    }
  }

  /**
   * Получить общее количество заказов в очереди (waiting + active)
   */
  async getQueueSize(): Promise<number> {
    const waiting = await this.orderQueue.getWaitingCount();
    const active = await this.orderQueue.getActiveCount();
    return waiting + active;
  }

  /**
   * Получить позицию заказа в очереди
   * Возвращает 0 если заказ активен (обрабатывается), или номер в очереди (1-based)
   * Возвращает null если заказ не найден в очереди
   */
  async getQueuePosition(orderId: string): Promise<number | null> {
    const job = await this.orderQueue.getJob(`order-${orderId}`);
    if (!job) return null;

    const state = await job.getState();
    if (state === 'active') return 0; // currently processing
    if (state !== 'waiting' && state !== 'delayed') return null;

    // Get all waiting jobs to find position
    const waitingJobs = await this.orderQueue.getWaiting(0, 100);
    const index = waitingJobs.findIndex(j => j.id === `order-${orderId}`);
    return index >= 0 ? index + 1 : null; // 1-based position
  }
}
