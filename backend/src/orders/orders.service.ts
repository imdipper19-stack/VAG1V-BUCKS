import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, LessThan } from 'typeorm';
import { nanoid } from 'nanoid';
import {
  Order,
  OrderStatusEnum,
  TimelineLogEntry,
  LogLevel,
} from '../database/entities';

export interface FindOrdersParams {
  status?: OrderStatusEnum | OrderStatusEnum[];
  sellerId?: string;
  limit?: number;
  offset?: number;
}

export interface FindOrdersResult {
  orders: Order[];
  total: number;
  limit: number;
  offset: number;
}

export interface CreateOrderData {
  vbucksAmount: number;
  priceTRY: number;
  sellerId?: string;
  webhookUrl?: string;
  region?: string;
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(TimelineLogEntry)
    private readonly timelineLogRepository: Repository<TimelineLogEntry>,
  ) {}

  async createOrder(data: CreateOrderData): Promise<Order> {
    const orderId = `VB-${new Date().getFullYear()}-${nanoid(6).toUpperCase()}`;
    const shortUrlSlug = nanoid(10);

    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 60);

    const order = this.orderRepository.create({
      orderId,
      shortUrlSlug,
      vbucksAmount: data.vbucksAmount,
      priceTRY: data.priceTRY,
      currency: 'TRY',
      region: data.region || 'TR',
      status: OrderStatusEnum.PENDING,
      sellerId: data.sellerId,
      webhookUrl: data.webhookUrl,
      expiresAt,
    });

    const savedOrder = await this.orderRepository.save(order);

    await this.addTimelineLog(savedOrder.id, {
      tag: '[system]',
      message: 'Order created',
      level: LogLevel.INFO,
    });

    this.logger.log(`Order created: ${orderId}`);
    return savedOrder;
  }

  async findById(id: string): Promise<Order> {
    const order = await this.orderRepository.findOne({
      where: { id },
      relations: ['timelineLogs'],
      order: { timelineLogs: { timestamp: 'ASC' } },
    });
    if (!order) {
      throw new Error('Order not found');
    }
    return order;
  }

  async findByOrderId(orderId: string): Promise<Order> {
    const order = await this.orderRepository.findOne({
      where: { orderId },
      relations: ['timelineLogs'],
      order: { timelineLogs: { timestamp: 'ASC' } },
    });
    if (!order) {
      throw new Error('Order not found');
    }
    return order;
  }

  async findBySlug(slug: string): Promise<Order> {
    const order = await this.orderRepository.findOne({
      where: { shortUrlSlug: slug },
      relations: ['timelineLogs'],
      order: { timelineLogs: { timestamp: 'ASC' } },
    });
    if (!order) {
      throw new Error('Order not found');
    }
    return order;
  }

  /**
   * Получить заказы с фильтрацией и пагинацией на уровне БД.
   * Возвращает orders + total для UI пагинации.
   */
  async findOrders(params: FindOrdersParams = {}): Promise<FindOrdersResult> {
    const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
    const offset = Math.max(params.offset ?? 0, 0);

    const qb = this.orderRepository
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.timelineLogs', 'timelineLogs')
      .orderBy('order.createdAt', 'DESC')
      .addOrderBy('timelineLogs.timestamp', 'ASC')
      .skip(offset)
      .take(limit);

    if (params.status) {
      if (Array.isArray(params.status)) {
        qb.andWhere('order.status IN (:...statuses)', { statuses: params.status });
      } else {
        qb.andWhere('order.status = :status', { status: params.status });
      }
    }

    if (params.sellerId) {
      qb.andWhere('order.sellerId = :sellerId', { sellerId: params.sellerId });
    }

    const [orders, total] = await qb.getManyAndCount();
    return { orders, total, limit, offset };
  }

  /**
   * @deprecated Используйте findOrders() для пагинации. Этот метод грузит ВСЁ в память.
   * Оставлен для совместимости с местами, где нужно итерироваться по всем заказам
   * (например, бэкап). Не использовать в hot path.
   */
  async findAll(limit?: number): Promise<Order[]> {
    const qb = this.orderRepository
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.timelineLogs', 'timelineLogs')
      .orderBy('order.createdAt', 'DESC');

    if (limit) {
      qb.take(limit);
    }

    return qb.getMany();
  }

  /**
   * Эффективный поиск просроченных заказов для OrderExpirationService.
   * Тянет только заказы со статусом PENDING/AWAITING_AUTH и expiresAt < now.
   */
  async findExpiredOrders(now: Date = new Date()): Promise<Order[]> {
    return this.orderRepository.find({
      where: {
        status: In([OrderStatusEnum.PENDING, OrderStatusEnum.AWAITING_AUTH]),
        expiresAt: LessThan(now),
      },
      select: ['id', 'orderId', 'status', 'expiresAt'],
    });
  }

  async updateOrder(id: string, data: Partial<Order>): Promise<Order> {
    await this.orderRepository.update(id, {
      ...data,
      updatedAt: new Date(),
    });
    return this.findById(id);
  }

  async updateStatus(
    id: string,
    status: OrderStatusEnum,
    additionalData?: Partial<Order>,
  ): Promise<Order> {
    const updateData: Partial<Order> = {
      status,
      ...additionalData,
    };

    if (status === OrderStatusEnum.COMPLETED) {
      updateData.completedAt = new Date();
    }

    await this.orderRepository.update(id, updateData);

    await this.addTimelineLog(id, {
      tag: '[system]',
      message: `Status changed to ${status}`,
      level: LogLevel.INFO,
    });

    return this.findById(id);
  }

  async addTimelineLog(
    id: string,
    log: { tag: string; message: string; level?: LogLevel },
  ): Promise<TimelineLogEntry> {
    const logEntry = this.timelineLogRepository.create({
      orderId: id,
      tag: log.tag,
      message: log.message,
      level: log.level || LogLevel.INFO,
    });

    return this.timelineLogRepository.save(logEntry);
  }

  async addTimelineLogDirect(
    orderId: string,
    tag: string,
    message: string,
    level: LogLevel = LogLevel.INFO,
  ): Promise<void> {
    const logEntry = this.timelineLogRepository.create({
      orderId,
      tag,
      message,
      level,
    });
    await this.timelineLogRepository.save(logEntry);
  }

  /**
   * Получить статистику заказов
   */
  async getStats(): Promise<{
    total: number;
    pending: number;
    processing: number;
    completed: number;
    failed: number;
  }> {
    const total = await this.orderRepository.count();
    const pending = await this.orderRepository.count({
      where: { status: OrderStatusEnum.PENDING },
    });
    const processing = await this.orderRepository.count({
      where: { status: OrderStatusEnum.PROCESSING },
    });
    const completed = await this.orderRepository.count({
      where: { status: OrderStatusEnum.COMPLETED },
    });
    const failed = await this.orderRepository.count({
      where: { status: OrderStatusEnum.FAILED },
    });

    return { total, pending, processing, completed, failed };
  }

  /**
   * Увеличить счётчик повторных попыток
   */
  async incrementRetryCount(id: string): Promise<void> {
    await this.orderRepository.increment({ id }, 'retryCount', 1);
  }

  /**
   * Записать ошибку в заказ
   */
  async setError(id: string, errorMessage: string): Promise<void> {
    await this.orderRepository.update(id, {
      errorMessage,
      status: OrderStatusEnum.FAILED,
    });
  }
}
