/**
 * API Capture Utility
 * 
 * Открывает браузер и записывает ВСЕ HTTP-запросы при ручной покупке V-Bucks.
 * Результат — JSON-файл с полным flow для последующего reverse engineering.
 *
 * Запуск:
 *   npx ts-node src/api-capture/capture.ts [--razer-cookies path/to/cookies.json]
 *
 * После запуска:
 *   1. Браузер откроется (видимый режим)
 *   2. Залогинься в Epic Games если нужно
 *   3. Пройди полный flow покупки V-Bucks (через Razer Gold)
 *   4. После завершения — закрой браузер или нажми Ctrl+C
 *   5. Файл captured-requests.json будет создан автоматически
 */

import { chromium, Browser, BrowserContext, Request, Response } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

// Домены которые нас интересуют для capture
const INTERESTING_DOMAINS = [
  'epicgames.com',
  'razer.com',
  'razergold',
  'fortnite.com',
  'unrealengine.com',
];

// Паттерны URL которые точно нужно записать полностью (включая body)
const CRITICAL_PATTERNS = [
  '/api/',
  '/graphql',
  '/purchase',
  '/checkout',
  '/order',
  '/payment',
  '/ecom',
  '/store',
  '/catalog',
  '/wallet',
  '/oauth',
  '/token',
  '/exchange',
  '/confirm',
  '/cart',
  '/offer',
  '/entitlement',
];

interface CapturedRequest {
  timestamp: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  postData: string | null;
  resourceType: string;
  // Response
  status: number | null;
  responseHeaders: Record<string, string> | null;
  responseBody: string | null;
  // Metadata
  isCritical: boolean;
  domain: string;
  timing: {
    startTime: number;
    endTime: number | null;
    durationMs: number | null;
  };
}

class ApiCapture {
  private capturedRequests: CapturedRequest[] = [];
  private startTime = Date.now();
  private outputPath: string;
  private razerCookiesPath: string | null = null;

  constructor() {
    this.outputPath = path.resolve(__dirname, 'captured-requests.json');
    this.parseArgs();
  }

  private parseArgs(): void {
    const args = process.argv.slice(2);
    const cookiesIdx = args.indexOf('--razer-cookies');
    if (cookiesIdx !== -1 && args[cookiesIdx + 1]) {
      this.razerCookiesPath = args[cookiesIdx + 1];
    }
  }

  private isInteresting(url: string): boolean {
    return INTERESTING_DOMAINS.some(d => url.includes(d));
  }

  private isCritical(url: string): boolean {
    return CRITICAL_PATTERNS.some(p => url.toLowerCase().includes(p));
  }

  private getDomain(url: string): string {
    try {
      return new URL(url).hostname;
    } catch {
      return 'unknown';
    }
  }

  private sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
    const result = { ...headers };
    // Оставляем Authorization и Cookie для анализа (но потом не коммитить!)
    return result;
  }

  async run(): Promise<void> {
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║          API CAPTURE — Перехват запросов покупки            ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log('║  1. Браузер откроется в ВИДИМОМ режиме                     ║');
    console.log('║  2. Пройди полный flow покупки V-Bucks                     ║');
    console.log('║  3. Закрой браузер или нажми Ctrl+C когда закончишь        ║');
    console.log('║  4. Результат: captured-requests.json                      ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log('');

    const browser = await chromium.launch({
      headless: false,
      args: [
        '--window-size=1400,900',
        '--disable-blink-features=AutomationControlled',
      ],
    });

    const contextOptions: any = {
      viewport: { width: 1400, height: 900 },
      locale: 'tr-TR',
      timezoneId: 'Europe/Istanbul',
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    };

    const context = await browser.newContext(contextOptions);

    // Загружаем куки Razer если переданы
    if (this.razerCookiesPath) {
      await this.loadRazerCookies(context);
    }

    // Слушаем ВСЕ запросы
    context.on('request', (request) => this.onRequest(request));
    context.on('response', (response) => this.onResponse(response));

    // Открываем страницу Epic Store
    const page = await context.newPage();

    console.log('🌐 Открываю Epic Games Store...');
    console.log('');
    await page.goto('https://store.epicgames.com/tr/p/fortnite--2800-v-bucks-core', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });

    console.log('✅ Страница загружена.');
    console.log('');
    console.log('📋 ИНСТРУКЦИЯ:');
    console.log('   1. Залогинься в Epic (если ещё не авторизован)');
    console.log('   2. Нажми "Buy Now" / "Satın Al"');
    console.log('   3. Выбери Razer Gold Wallet');
    console.log('   4. Подтверди оплату на Razer');
    console.log('   5. Дождись завершения (order complete)');
    console.log('   6. Закрой браузер');
    console.log('');
    console.log(`📊 Записываю запросы... (${this.capturedRequests.length} пока)`);

    // Обработка закрытия
    const saveAndExit = () => {
      this.save();
      process.exit(0);
    };

    process.on('SIGINT', saveAndExit);
    process.on('SIGTERM', saveAndExit);

    // Ждём пока браузер закроется
    await new Promise<void>((resolve) => {
      browser.on('disconnected', () => {
        resolve();
      });
    });

    this.save();
  }

  private async loadRazerCookies(context: BrowserContext): Promise<void> {
    if (!this.razerCookiesPath) return;

    try {
      const raw = fs.readFileSync(this.razerCookiesPath, 'utf-8');
      const cookies = JSON.parse(raw);

      if (Array.isArray(cookies)) {
        const normalized = cookies.map((c: any) => ({
          name: c.name,
          value: c.value,
          domain: c.domain || '.razer.com',
          path: c.path || '/',
          httpOnly: c.httpOnly ?? false,
          secure: c.secure ?? true,
          sameSite: 'Lax' as const,
          expires: c.expirationDate || c.expires || -1,
        }));
        await context.addCookies(normalized);
        console.log(`🍪 Загружено ${normalized.length} Razer-кук из ${this.razerCookiesPath}`);
      }
    } catch (err: any) {
      console.warn(`⚠️  Не удалось загрузить куки: ${err.message}`);
    }
  }

  private onRequest(request: Request): void {
    const url = request.url();
    if (!this.isInteresting(url)) return;

    // Пропускаем статику (изображения, шрифты, css)
    const type = request.resourceType();
    if (['image', 'font', 'stylesheet', 'media'].includes(type) && !this.isCritical(url)) {
      return;
    }

    const entry: CapturedRequest = {
      timestamp: new Date().toISOString(),
      url,
      method: request.method(),
      headers: this.sanitizeHeaders(request.headers()),
      postData: request.postData() || null,
      resourceType: type,
      status: null,
      responseHeaders: null,
      responseBody: null,
      isCritical: this.isCritical(url),
      domain: this.getDomain(url),
      timing: {
        startTime: Date.now() - this.startTime,
        endTime: null,
        durationMs: null,
      },
    };

    this.capturedRequests.push(entry);

    // Лог в консоль
    const icon = entry.isCritical ? '🔴' : '⚪';
    const short = url.length > 100 ? url.substring(0, 100) + '...' : url;
    console.log(`${icon} ${entry.method} ${short}`);
  }

  private async onResponse(response: Response): Promise<void> {
    const url = response.url();
    if (!this.isInteresting(url)) return;

    // Находим соответствующий request
    const entry = this.capturedRequests.find(
      (r) => r.url === url && r.status === null,
    );
    if (!entry) return;

    entry.status = response.status();
    entry.responseHeaders = response.headers();
    entry.timing.endTime = Date.now() - this.startTime;
    entry.timing.durationMs = entry.timing.endTime - entry.timing.startTime;

    // Читаем body только для critical запросов (API/JSON)
    if (entry.isCritical) {
      try {
        const contentType = response.headers()['content-type'] || '';
        if (
          contentType.includes('json') ||
          contentType.includes('text') ||
          contentType.includes('html')
        ) {
          const body = await response.text().catch(() => null);
          if (body && body.length < 500_000) {
            // Ограничиваем размер чтобы не раздуть файл
            entry.responseBody = body;
          }
        }
      } catch {
        // ignore — response might be already consumed
      }
    }

    const statusIcon = entry.status >= 200 && entry.status < 400 ? '✅' : '❌';
    if (entry.isCritical) {
      console.log(`   ${statusIcon} ${entry.status} (${entry.timing.durationMs}ms)`);
    }
  }

  private save(): void {
    // Сохраняем полный дамп
    fs.writeFileSync(this.outputPath, JSON.stringify(this.capturedRequests, null, 2));

    // Сохраняем отдельно только critical запросы (более компактный файл для анализа)
    const criticalOnly = this.capturedRequests.filter((r) => r.isCritical);
    const criticalPath = path.resolve(__dirname, 'captured-critical.json');
    fs.writeFileSync(criticalPath, JSON.stringify(criticalOnly, null, 2));

    // Сохраняем summary — краткий список в читаемом формате
    const summaryPath = path.resolve(__dirname, 'captured-summary.txt');
    const summaryLines = this.capturedRequests
      .filter((r) => r.isCritical)
      .map((r) => {
        const body = r.postData ? ` | Body: ${r.postData.substring(0, 200)}` : '';
        return `[${r.timing.startTime}ms] ${r.method} ${r.url} → ${r.status}${body}`;
      });

    fs.writeFileSync(
      summaryPath,
      [
        `=== API CAPTURE SUMMARY ===`,
        `Date: ${new Date().toISOString()}`,
        `Total requests: ${this.capturedRequests.length}`,
        `Critical requests: ${criticalOnly.length}`,
        `Duration: ${((Date.now() - this.startTime) / 1000).toFixed(1)}s`,
        ``,
        `=== CRITICAL API CALLS (in order) ===`,
        ``,
        ...summaryLines,
      ].join('\n'),
    );

    console.log('');
    console.log('═══════════════════════════════════════════');
    console.log(`✅ Записано ${this.capturedRequests.length} запросов`);
    console.log(`   🔴 Critical: ${criticalOnly.length}`);
    console.log(`   📁 Full dump: ${this.outputPath}`);
    console.log(`   📁 Critical only: ${criticalPath}`);
    console.log(`   📁 Summary: ${summaryPath}`);
    console.log('═══════════════════════════════════════════');
  }
}

// --- Entry point ---
const capture = new ApiCapture();
capture.run().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
