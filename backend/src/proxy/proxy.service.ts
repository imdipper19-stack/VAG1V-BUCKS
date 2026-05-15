import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Proxy, ProxyStatus, ProxyType } from '../database/entities';
import axios from 'axios';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { HttpsProxyAgent } = require('https-proxy-agent');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { SocksProxyAgent } = require('socks-proxy-agent');

@Injectable()
export class ProxyService {
  private readonly logger = new Logger(ProxyService.name);

  constructor(
    @InjectRepository(Proxy)
    private proxyRepository: Repository<Proxy>,
  ) {}

  async createProxy(data: {
    host: string;
    port: number;
    username?: string;
    password?: string;
    type: ProxyType;
  }): Promise<Proxy> {
    const proxy = this.proxyRepository.create(data);
    return this.proxyRepository.save(proxy);
  }

  async getProxies(): Promise<Proxy[]> {
    return this.proxyRepository.find({ order: { createdAt: 'DESC' } });
  }

  async getProxyById(id: string): Promise<Proxy | null> {
    return this.proxyRepository.findOne({ where: { id } });
  }

  async updateProxy(id: string, data: Partial<Proxy>): Promise<Proxy | null> {
    await this.proxyRepository.update(id, data);
    return this.getProxyById(id);
  }

  async deleteProxy(id: string): Promise<void> {
    await this.proxyRepository.delete(id);
  }

  async testProxy(id: string): Promise<{ success: boolean; latency?: number; ip?: string; error?: string }> {
    const proxy = await this.getProxyById(id);
    if (!proxy) {
      throw new Error('Proxy not found');
    }

    const startTime = Date.now();

    try {
      const proxyType = (proxy.type || 'http').toString().toLowerCase();
      const isSocks = proxyType.includes('socks');

      let ip: string | undefined;

      if (isSocks) {
        // SOCKS прокси — используем SocksProxyAgent
        const authPart = proxy.username && proxy.password
          ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password)}@`
          : '';
        const proxyUrl = `socks5://${authPart}${proxy.host}:${proxy.port}`;
        const agent = new SocksProxyAgent(proxyUrl);

        const response = await axios.get('http://api.ipify.org?format=json', {
          timeout: 10000,
          httpAgent: agent,
          httpsAgent: agent,
          proxy: false,
        });
        ip = response.data?.ip || proxy.host;
      } else {
        // HTTP прокси — используем axios proxy config напрямую (без агента)
        const response = await axios.get('http://api.ipify.org?format=json', {
          timeout: 10000,
          proxy: {
            host: proxy.host,
            port: proxy.port,
            auth: proxy.username && proxy.password
              ? { username: proxy.username, password: proxy.password }
              : undefined,
            protocol: 'http',
          },
        });
        ip = response.data?.ip || proxy.host;
      }

      const latency = Date.now() - startTime;

      await this.proxyRepository.update(id, {
        status: ProxyStatus.ACTIVE,
        successCount: proxy.successCount + 1,
        lastTestedAt: Date.now(),
        latency,
      });

      this.logger.log(`Proxy ${proxy.host}:${proxy.port} (${proxyType}) OK — ${latency}ms, IP: ${ip}`);
      return { success: true, latency, ip };
    } catch (error: any) {
      this.logger.error(`Proxy test failed for ${proxy.host}:${proxy.port}: ${error.message}`);

      await this.proxyRepository.update(id, {
        status: ProxyStatus.FAILED,
        failureCount: proxy.failureCount + 1,
        lastTestedAt: Date.now(),
      });

      return { success: false, error: error.message };
    }
  }

  async getActiveProxy(): Promise<Proxy | null> {
    const proxies = await this.proxyRepository.find({
      where: { status: ProxyStatus.ACTIVE },
      order: { successCount: 'DESC' },
    });

    if (proxies.length === 0) {
      return null;
    }

    // Return proxy with highest success rate
    return proxies[0];
  }

  async setDefaultProxy(id: string): Promise<void> {
    // Remove default from all proxies
    await this.proxyRepository.update({}, { isDefault: false });
    // Set new default
    await this.proxyRepository.update(id, { isDefault: true });
  }

  async rotateProxy(): Promise<Proxy | null> {
    const proxies = await this.proxyRepository.find({
      where: { status: ProxyStatus.ACTIVE },
      order: { lastUsedAt: 'ASC' },
    });

    if (proxies.length === 0) {
      return null;
    }

    // Get least recently used proxy
    const proxy = proxies[0];

    // Update last used time
    await this.proxyRepository.update(proxy.id, {
      lastUsedAt: Date.now(),
    });

    return proxy;
  }

  async getProxyStats(): Promise<{
    total: number;
    active: number;
    inactive: number;
    failed: number;
    avgLatency: number;
  }> {
    const proxies = await this.getProxies();

    const active = proxies.filter(p => p.status === ProxyStatus.ACTIVE).length;
    const inactive = proxies.filter(p => p.status === ProxyStatus.INACTIVE).length;
    const failed = proxies.filter(p => p.status === ProxyStatus.FAILED).length;

    const workingProxies = proxies.filter(p => p.latency);
    const avgLatency = workingProxies.length > 0
      ? workingProxies.reduce((sum, p) => sum + p.latency, 0) / workingProxies.length
      : 0;

    return {
      total: proxies.length,
      active,
      inactive,
      failed,
      avgLatency: Math.round(avgLatency),
    };
  }
}
