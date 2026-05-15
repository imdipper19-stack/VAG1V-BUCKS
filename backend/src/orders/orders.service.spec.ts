import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrdersService, FindOrdersParams } from './orders.service';
import { Order, OrderStatusEnum, TimelineLogEntry } from '../database/entities';

describe('OrdersService', () => {
  let service: OrdersService;
  let orderRepository: Repository<Order>;
  let timelineLogRepository: Repository<TimelineLogEntry>;

  const mockOrder = {
    id: '1',
    orderId: 'VB-2024-ABC123',
    shortUrlSlug: 'test-slug',
    vbucksAmount: 1000,
    priceTRY: 155,
    currency: 'TRY',
    region: 'TR',
    status: OrderStatusEnum.PENDING,
    sellerId: 'seller-123',
    webhookUrl: 'https://example.com/webhook',
    expiresAt: new Date(Date.now() + 3600000),
    createdAt: new Date(),
    updatedAt: new Date(),
    timelineLogs: [],
  };

  const mockQueryBuilder = {
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn(),
    getMany: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        {
          provide: getRepositoryToken(Order),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            findOne: jest.fn(),
            find: jest.fn(),
            update: jest.fn(),
            increment: jest.fn(),
            count: jest.fn(),
            createQueryBuilder: jest.fn(() => mockQueryBuilder),
          },
        },
        {
          provide: getRepositoryToken(TimelineLogEntry),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<OrdersService>(OrdersService);
    orderRepository = module.get<Repository<Order>>(getRepositoryToken(Order));
    timelineLogRepository = module.get<Repository<TimelineLogEntry>>(
      getRepositoryToken(TimelineLogEntry),
    );

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findOrders', () => {
    it('should return orders with pagination', async () => {
      const mockOrders = [mockOrder];
      mockQueryBuilder.getManyAndCount.mockResolvedValue([mockOrders, 1]);

      const params: FindOrdersParams = {};
      const result = await service.findOrders(params);

      expect(result.orders).toEqual(mockOrders);
      expect(result.total).toBe(1);
      expect(result.limit).toBe(50);
      expect(result.offset).toBe(0);
    });

    it('should apply status filter (single)', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      const params: FindOrdersParams = { status: OrderStatusEnum.PENDING };
      await service.findOrders(params);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'order.status = :status',
        { status: OrderStatusEnum.PENDING },
      );
    });

    it('should apply status filter (array)', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      const params: FindOrdersParams = {
        status: [OrderStatusEnum.PENDING, OrderStatusEnum.COMPLETED],
      };
      await service.findOrders(params);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'order.status IN (:...statuses)',
        { statuses: [OrderStatusEnum.PENDING, OrderStatusEnum.COMPLETED] },
      );
    });

    it('should apply sellerId filter', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      const params: FindOrdersParams = { sellerId: 'seller-123' };
      await service.findOrders(params);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'order.sellerId = :sellerId',
        { sellerId: 'seller-123' },
      );
    });

    it('should apply both status and sellerId filters', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      const params: FindOrdersParams = {
        status: OrderStatusEnum.PENDING,
        sellerId: 'seller-123',
      };
      await service.findOrders(params);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledTimes(2);
    });

    it('should respect custom limit', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      const params: FindOrdersParams = { limit: 25 };
      await service.findOrders(params);

      expect(mockQueryBuilder.take).toHaveBeenCalledWith(25);
    });

    it('should clamp limit to maximum (200)', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      const params: FindOrdersParams = { limit: 300 };
      await service.findOrders(params);

      expect(mockQueryBuilder.take).toHaveBeenCalledWith(200);
    });

    it('should clamp limit to minimum (1)', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      const params: FindOrdersParams = { limit: 0 };
      await service.findOrders(params);

      expect(mockQueryBuilder.take).toHaveBeenCalledWith(1);
    });

    it('should clamp negative limit to minimum (1)', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      const params: FindOrdersParams = { limit: -10 };
      await service.findOrders(params);

      expect(mockQueryBuilder.take).toHaveBeenCalledWith(1);
    });

    it('should respect custom offset', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      const params: FindOrdersParams = { offset: 100 };
      await service.findOrders(params);

      expect(mockQueryBuilder.skip).toHaveBeenCalledWith(100);
    });

    it('should clamp negative offset to 0', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      const params: FindOrdersParams = { offset: -10 };
      await service.findOrders(params);

      expect(mockQueryBuilder.skip).toHaveBeenCalledWith(0);
    });

    it('should use default limit and offset when not provided', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await service.findOrders({});

      expect(mockQueryBuilder.skip).toHaveBeenCalledWith(0);
      expect(mockQueryBuilder.take).toHaveBeenCalledWith(50);
    });

    it('should order by createdAt DESC and timelineLogs ASC', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await service.findOrders({});

      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith('order.createdAt', 'DESC');
      expect(mockQueryBuilder.addOrderBy).toHaveBeenCalledWith('timelineLogs.timestamp', 'ASC');
    });

    it('should include timelineLogs in results', async () => {
      const orderWithLogs = {
        ...mockOrder,
        timelineLogs: [{ id: '1', message: 'Test log', timestamp: new Date() }],
      };
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[orderWithLogs], 1]);

      const result = await service.findOrders({});

      expect(result.orders[0].timelineLogs).toBeDefined();
      expect(result.orders[0].timelineLogs).toHaveLength(1);
    });

    it('should return empty array when no orders found', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      const result = await service.findOrders({});

      expect(result.orders).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  describe('findExpiredOrders', () => {
    it('should find expired orders with PENDING and AWAITING_AUTH status', async () => {
      const expiredOrders = [mockOrder];
      (orderRepository.find as jest.Mock).mockResolvedValue(expiredOrders);

      const result = await service.findExpiredOrders();

      expect(orderRepository.find).toHaveBeenCalled();
      expect(result).toEqual(expiredOrders);
    });

    it('should accept custom date parameter', async () => {
      const customDate = new Date('2024-01-01');
      (orderRepository.find as jest.Mock).mockResolvedValue([]);

      await service.findExpiredOrders(customDate);

      expect(orderRepository.find).toHaveBeenCalled();
    });
  });

  describe('createOrder', () => {
    it('should create an order with generated IDs', async () => {
      (orderRepository.create as jest.Mock).mockReturnValue(mockOrder);
      (orderRepository.save as jest.Mock).mockResolvedValue(mockOrder);
      (timelineLogRepository.create as jest.Mock).mockReturnValue({});
      (timelineLogRepository.save as jest.Mock).mockResolvedValue({});

      const data = {
        vbucksAmount: 1000,
        priceTRY: 155,
        sellerId: 'seller-123',
      };

      const result = await service.createOrder(data);

      expect(result).toEqual(mockOrder);
      expect(orderRepository.create).toHaveBeenCalled();
      expect(orderRepository.save).toHaveBeenCalled();
      expect(timelineLogRepository.save).toHaveBeenCalled();
    });

    it('should set expiration to 1 hour from now', async () => {
      (orderRepository.create as jest.Mock).mockReturnValue(mockOrder);
      (orderRepository.save as jest.Mock).mockResolvedValue(mockOrder);
      (timelineLogRepository.create as jest.Mock).mockReturnValue({});
      (timelineLogRepository.save as jest.Mock).mockResolvedValue({});

      await service.createOrder({ vbucksAmount: 1000, priceTRY: 155 });

      const createCall = (orderRepository.create as jest.Mock).mock.calls[0][0];
      const expiresAtDiff = createCall.expiresAt.getTime() - Date.now();
      expect(expiresAtDiff).toBeGreaterThan(3500000); // ~58 minutes
      expect(expiresAtDiff).toBeLessThan(3700000); // ~62 minutes
    });
  });

  describe('findById', () => {
    it('should find order by id with timeline logs', async () => {
      (orderRepository.findOne as jest.Mock).mockResolvedValue(mockOrder);

      const result = await service.findById('1');

      expect(orderRepository.findOne).toHaveBeenCalledWith({
        where: { id: '1' },
        relations: ['timelineLogs'],
        order: { timelineLogs: { timestamp: 'ASC' } },
      });
      expect(result).toEqual(mockOrder);
    });

    it('should throw error when order not found', async () => {
      (orderRepository.findOne as jest.Mock).mockResolvedValue(null);

      await expect(service.findById('nonexistent')).rejects.toThrow('Order not found');
    });
  });

  describe('updateStatus', () => {
    it('should update order status and add timeline log', async () => {
      (orderRepository.update as jest.Mock).mockResolvedValue({});
      (orderRepository.findOne as jest.Mock).mockResolvedValue(mockOrder);
      (timelineLogRepository.create as jest.Mock).mockReturnValue({});
      (timelineLogRepository.save as jest.Mock).mockResolvedValue({});

      const result = await service.updateStatus('1', OrderStatusEnum.COMPLETED);

      expect(orderRepository.update).toHaveBeenCalledWith(
        '1',
        expect.objectContaining({
          status: OrderStatusEnum.COMPLETED,
          completedAt: expect.any(Date),
        }),
      );
      expect(result).toEqual(mockOrder);
    });

    it('should set completedAt when status is COMPLETED', async () => {
      (orderRepository.update as jest.Mock).mockResolvedValue({});
      (orderRepository.findOne as jest.Mock).mockResolvedValue(mockOrder);
      (timelineLogRepository.create as jest.Mock).mockReturnValue({});
      (timelineLogRepository.save as jest.Mock).mockResolvedValue({});

      await service.updateStatus('1', OrderStatusEnum.COMPLETED);

      const updateCall = (orderRepository.update as jest.Mock).mock.calls[0][1];
      expect(updateCall.completedAt).toBeDefined();
      expect(updateCall.completedAt).toBeInstanceOf(Date);
    });

    it('should not set completedAt for other statuses', async () => {
      (orderRepository.update as jest.Mock).mockResolvedValue({});
      (orderRepository.findOne as jest.Mock).mockResolvedValue(mockOrder);
      (timelineLogRepository.create as jest.Mock).mockReturnValue({});
      (timelineLogRepository.save as jest.Mock).mockResolvedValue({});

      await service.updateStatus('1', OrderStatusEnum.PROCESSING);

      const updateCall = (orderRepository.update as jest.Mock).mock.calls[0][1];
      expect(updateCall.completedAt).toBeUndefined();
    });
  });

  describe('getStats', () => {
    it('should return order statistics', async () => {
      (orderRepository.count as jest.Mock)
        .mockResolvedValueOnce(100) // total
        .mockResolvedValueOnce(10) // pending
        .mockResolvedValueOnce(20) // processing
        .mockResolvedValueOnce(60) // completed
        .mockResolvedValueOnce(10); // failed

      const stats = await service.getStats();

      expect(stats).toEqual({
        total: 100,
        pending: 10,
        processing: 20,
        completed: 60,
        failed: 10,
      });
    });
  });

  describe('incrementRetryCount', () => {
    it('should increment retry count for order', async () => {
      (orderRepository.increment as jest.Mock).mockResolvedValue({});

      await service.incrementRetryCount('1');

      expect(orderRepository.increment).toHaveBeenCalledWith({ id: '1' }, 'retryCount', 1);
    });
  });

  describe('setError', () => {
    it('should set error message and mark as failed', async () => {
      (orderRepository.update as jest.Mock).mockResolvedValue({});

      await service.setError('1', 'Test error');

      expect(orderRepository.update).toHaveBeenCalledWith('1', {
        errorMessage: 'Test error',
        status: OrderStatusEnum.FAILED,
      });
    });
  });
});
