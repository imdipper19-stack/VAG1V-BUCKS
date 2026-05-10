import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createOrder(@Body() createOrderDto: CreateOrderDto) {
    const order = this.ordersService.createOrder({
      vbucksAmount: createOrderDto.vbucksAmount,
      priceTRY: createOrderDto.priceTRY,
      sellerId: createOrderDto.sellerId,
      webhookUrl: createOrderDto.webhookUrl,
    });

    const baseUrl = process.env.BASE_URL || 'http://localhost:3002';

    return {
      success: true,
      data: {
        orderId: order.orderId,
        shortUrl: `${baseUrl}/order/${order.orderId}`,
        expiresAt: order.expiresAt,
      },
    };
  }

  // Сначала статичные маршруты
  @Get('by-slug/:slug')
  async getOrderBySlug(@Param('slug') slug: string) {
    const order = this.ordersService.findBySlug(slug);

    return {
      success: true,
      data: {
        orderId: order.orderId,
        vbucksAmount: order.vbucksAmount,
        priceTRY: order.priceTRY,
        currency: order.currency,
        status: order.status,
        expiresAt: order.expiresAt,
        timelineLogs: order.timelineLogs,
        epicDeviceCode: order.epicDeviceCode,
        epicDeviceCodeExpiresAt: order.epicDeviceCodeExpiresAt,
      },
    };
  }

  @Get('by-id/:orderId')
  async getOrderById(@Param('orderId') orderId: string) {
    const order = this.ordersService.findByOrderId(orderId);

    return {
      success: true,
      data: order,
    };
  }

  // Потом динамические
  @Get(':orderId/status')
  async getOrderStatus(@Param('orderId') orderId: string) {
    const order = this.ordersService.findByOrderId(orderId);

    return {
      success: true,
      data: {
        orderId: order.orderId,
        status: order.status,
        timelineLogs: order.timelineLogs,
        completedAt: order.completedAt,
        errorMessage: order.errorMessage,
      },
    };
  }

  @Get()
  async listOrders(@Query('limit') limit?: number) {
    let orders = this.ordersService.findAll();

    if (limit) {
      orders = orders.slice(0, parseInt(String(limit)));
    }

    return {
      success: true,
      data: orders,
      total: orders.length,
    };
  }
}
