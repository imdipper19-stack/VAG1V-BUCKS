import { Injectable } from '@nestjs/common';
import { nanoid } from 'nanoid';

export enum OrderStatus {
  PENDING = 'pending',
  AWAITING_AUTH = 'awaiting_auth',
  AUTH_COMPLETED = 'auth_completed',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export interface TimelineLog {
  timestamp: string;
  tag: string;
  message: string;
  status?: 'success' | 'error' | 'info';
}

export interface Order {
  id: string;
  orderId: string;
  shortUrlSlug: string;
  vbucksAmount: number;
  priceTRY: number;
  currency: string;
  status: string;
  epicDeviceCode?: string;
  epicUserCode?: string;
  epicDeviceCodeExpiresAt?: Date;
  epicAccessToken?: string;
  epicRefreshToken?: string;
  epicExchangeCode?: string;
  razerAccountId?: string;
  transactionId?: string;
  balanceBefore?: number;
  balanceAfter?: number;
  timelineLogs: TimelineLog[];
  webhookUrl?: string;
  webhookResponse?: string;
  screenshotUrl?: string;
  errorMessage?: string;
  sellerId?: string;
  buyerIp?: string;
  userAgent?: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  expiresAt: Date;
}

@Injectable()
export class OrdersService {
  private orders: Map<string, Order> = new Map();

  createOrder(data: {
    vbucksAmount: number;
    priceTRY: number;
    sellerId?: string;
    webhookUrl?: string;
  }): Order {
    const orderId = `VB-${new Date().getFullYear()}-${nanoid(6).toUpperCase()}`;
    const id = nanoid();
    const shortUrlSlug = nanoid(10);

    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 60);

    const order: Order = {
      id,
      orderId,
      shortUrlSlug,
      vbucksAmount: data.vbucksAmount,
      priceTRY: data.priceTRY,
      currency: 'TRY',
      status: OrderStatus.PENDING,
      sellerId: data.sellerId,
      webhookUrl: data.webhookUrl,
      timelineLogs: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt,
    };

    this.orders.set(id, order);
    return order;
  }

  findById(id: string): Order {
    const order = this.orders.get(id);
    if (!order) {
      throw new Error('Order not found');
    }
    return order;
  }

  findByOrderId(orderId: string): Order {
    const order = Array.from(this.orders.values()).find(o => o.orderId === orderId);
    if (!order) {
      throw new Error('Order not found');
    }
    return order;
  }

  findBySlug(slug: string): Order {
    const order = Array.from(this.orders.values()).find(o => o.shortUrlSlug === slug);
    if (!order) {
      throw new Error('Order not found');
    }
    return order;
  }

  findAll(): Order[] {
    return Array.from(this.orders.values()).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );
  }

  updateStatus(id: string, status: string, data: Partial<Order>): Order {
    const order = this.findById(id);
    Object.assign(order, data, { updatedAt: new Date() });
    if (data.status) {
      order.status = data.status;
    }
    if (status !== order.status) {
      order.status = status;
    }
    return order;
  }

  addTimelineLog(id: string, log: { tag: string; message: string; status?: 'success' | 'error' | 'info' }): void {
    const order = this.findById(id);
    order.timelineLogs.push({
      timestamp: new Date().toISOString(),
      ...log,
    });
  }
}
