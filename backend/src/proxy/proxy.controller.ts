import { Controller, Get, Post, Put, Delete, Body, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { ProxyService } from './proxy.service';
import { ProxyType, ProxyStatus } from '../database/entities';

@Controller('proxies')
export class ProxyController {
  constructor(private readonly proxyService: ProxyService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createProxy(@Body() body: {
    host: string;
    port: number;
    username?: string;
    password?: string;
    type: ProxyType;
  }) {
    const proxy = await this.proxyService.createProxy(body);
    return {
      success: true,
      data: proxy,
    };
  }

  @Get()
  async getProxies() {
    const proxies = await this.proxyService.getProxies();
    return {
      success: true,
      data: proxies,
    };
  }

  @Get('stats')
  async getProxyStats() {
    const stats = await this.proxyService.getProxyStats();
    return {
      success: true,
      data: stats,
    };
  }

  @Get(':id')
  async getProxy(@Param('id') id: string) {
    const proxy = await this.proxyService.getProxyById(id);
    if (!proxy) {
      return {
        success: false,
        error: 'Proxy not found',
      };
    }
    return {
      success: true,
      data: proxy,
    };
  }

  @Post(':id/test')
  @HttpCode(HttpStatus.OK)
  async testProxy(@Param('id') id: string) {
    const result = await this.proxyService.testProxy(id);
    return {
      success: true,
      data: result,
    };
  }

  @Put(':id')
  async updateProxy(
    @Param('id') id: string,
    @Body() body: Partial<{
      host: string;
      port: number;
      username: string;
      password: string;
      type: ProxyType;
      status: ProxyStatus;
      isDefault: boolean;
    }>,
  ) {
    const proxy = await this.proxyService.updateProxy(id, body);
    if (!proxy) {
      return {
        success: false,
        error: 'Proxy not found',
      };
    }
    return {
      success: true,
      data: proxy,
    };
  }

  @Post(':id/set-default')
  @HttpCode(HttpStatus.OK)
  async setDefaultProxy(@Param('id') id: string) {
    await this.proxyService.setDefaultProxy(id);
    return {
      success: true,
      data: { message: 'Default proxy set' },
    };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async deleteProxy(@Param('id') id: string) {
    await this.proxyService.deleteProxy(id);
    return {
      success: true,
      data: { message: 'Proxy deleted' },
    };
  }
}
