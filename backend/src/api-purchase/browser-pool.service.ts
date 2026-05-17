/**
 * BrowserPool — переиспользуемый набор Chromium-инстансов с применённым stealth-плагином.
 *
 * Зачем:
 *   - cold start Chromium с stealth ~3-5 сек. При concurrency=3 на каждом заказе экономим эти секунды.
 *   - browser создаётся БЕЗ прокси; прокси задаётся при создании context (Playwright поддерживает).
 *   - один browser обслуживает заказы с разными прокси и Razer-аккаунтами параллельно.
 *
 * Семантика:
 *   - acquire() возвращает свободный browser. Если все заняты и пул не превышен — лениво создаёт ещё.
 *   - release(browser) возвращает browser в пул. Если он крашнулся (browser.isConnected() === false)
 *     — выбрасывается из пула и пересоздаётся при следующем acquire().
 *   - shutdown() закрывает все browser-ы (вызывается при остановке Nest).
 */

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { Browser } from 'playwright';

interface PoolEntry {
  browser: Browser;
  busy: boolean;
}

@Injectable()
export class BrowserPool implements OnModuleDestroy {
  private readonly logger = new Logger(BrowserPool.name);
  private readonly pool: PoolEntry[] = [];
  private readonly maxSize: number;
  private readonly waiters: Array<(browser: Browser) => void> = [];
  private shuttingDown = false;

  constructor() {
    this.maxSize = Math.max(1, parseInt(process.env.ORDER_CONCURRENCY || '3', 10));
    this.logger.log(`BrowserPool initialized (maxSize=${this.maxSize})`);
  }

  /**
   * Берёт свободный browser. Если все заняты и пул не достиг maxSize — создаёт новый.
   * Если пул на максимуме — ждёт пока кто-то вернёт через release().
   */
  async acquire(): Promise<Browser> {
    if (this.shuttingDown) {
      throw new Error('BrowserPool is shutting down');
    }

    // 1. Сначала ищем уже созданный незанятый browser
    for (const entry of this.pool) {
      if (!entry.busy && entry.browser.isConnected()) {
        entry.busy = true;
        return entry.browser;
      }
    }

    // 2. Чистим мертвых
    for (let i = this.pool.length - 1; i >= 0; i--) {
      if (!this.pool[i].browser.isConnected()) {
        this.logger.warn('Removing dead browser from pool');
        this.pool.splice(i, 1);
      }
    }

    // 3. Можем создать ещё?
    if (this.pool.length < this.maxSize) {
      const browser = await this.launchBrowser();
      this.pool.push({ browser, busy: true });
      return browser;
    }

    // 4. Пул на максимуме — встаём в очередь
    this.logger.debug(`Pool full (${this.pool.length}/${this.maxSize}), waiting for free browser`);
    return new Promise<Browser>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  /**
   * Возвращает browser в пул. Если он крашнулся — закрываем и удаляем.
   */
  release(browser: Browser): void {
    const entry = this.pool.find((e) => e.browser === browser);
    if (!entry) {
      this.logger.warn('Tried to release browser not from pool');
      return;
    }

    if (!browser.isConnected()) {
      // Browser умер — выбрасываем из пула
      const idx = this.pool.indexOf(entry);
      this.pool.splice(idx, 1);
      this.logger.warn('Released browser is disconnected, removed from pool');
      return;
    }

    entry.busy = false;

    // Если кто-то ждал browser — отдаём ему
    if (this.waiters.length > 0) {
      const waiter = this.waiters.shift();
      if (waiter) {
        entry.busy = true;
        waiter(browser);
      }
    }
  }

  /**
   * Прогревает пул заранее (опционально). Вызывать после старта Nest, чтобы первый
   * заказ не оплачивал cold start.
   */
  async warmup(count: number = this.maxSize): Promise<void> {
    const target = Math.min(count, this.maxSize);
    this.logger.log(`Warming up pool (target=${target})...`);
    const acquired: Browser[] = [];
    for (let i = 0; i < target; i++) {
      acquired.push(await this.acquire());
    }
    for (const b of acquired) {
      this.release(b);
    }
    this.logger.log(`Pool warmed up (${target} browsers ready)`);
  }

  async onModuleDestroy(): Promise<void> {
    this.shuttingDown = true;
    this.logger.log(`Shutting down ${this.pool.length} browsers`);
    await Promise.all(
      this.pool.map((e) => e.browser.close().catch(() => {})),
    );
    this.pool.length = 0;
  }

  // ─────────────────────────────────────────────────────

  private async launchBrowser(): Promise<Browser> {
    const { chromium: stealthChromium } = require('playwright-extra');
    const StealthPlugin = require('puppeteer-extra-plugin-stealth');
    stealthChromium.use(StealthPlugin());

    this.logger.log('Launching new Chromium with stealth...');
    const t0 = Date.now();

    const launchOpts: any = {
      headless: process.env.API_PURCHASE_HEADLESS === 'true',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
      ],
      ignoreDefaultArgs: ['--enable-automation'],
    };

    // На проде используем системный Chromium (Debian apt-get install chromium).
    // ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH в Dockerfile НЕ работает с Playwright API,
    // нужно передавать явно в launch options.
    const systemChromium = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
    if (systemChromium) {
      launchOpts.executablePath = systemChromium;
    }

    const browser = (await stealthChromium.launch(launchOpts)) as Browser;
    this.logger.log(`Browser launched in ${Date.now() - t0}ms`);
    return browser;
  }
}
