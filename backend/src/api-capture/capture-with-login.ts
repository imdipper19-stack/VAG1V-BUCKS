/**
 * API Capture с автоматическим логином через exchange_code.
 *
 * Отличие от capture.ts:
 * - Автоматически логинится в Epic через exchange_code (как делает основная система)
 * - Ты только подтверждаешь покупку и проходишь Razer Gold flow
 *
 * Запуск:
 *   npx ts-node src/api-capture/capture-with-login.ts \
 *     --epic-token <access_token> \
 *     --razer-cookies ./cookies.json \
 *     --amount 2800
 *
 * Параметры:
 *   --epic-token    Access token покупателя (из orders.epicAccessToken)
 *   --razer-cookies Path к файлу с куками Razer Gold (JSON array)
 *   --amount        Количество V-Bucks (800, 2400, 4500, 12500) [default: 2800]
 */

import { chromium, Browser, BrowserContext, Page, Request, Response } from 'playwright';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

const INTERESTING_DOMAINS = [
  'epicgames.com',
  'razer.com',
  'razergold',
  'fortnite.com',
];

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
  '/quickPurchase',
  '/orderPreview',
  '/captureOrder',
  '/receipt',
];

const VBUCKS_SLUGS: Record<number, string> = {
  800: '800-v-bucks-core',
  2400: '2400-v-bucks-core',
  2800: '2800-v-bucks-core',
  4500: '4500-v-bucks-core',
  5000: '5000-v-bucks',
  12500: '12500-v-bucks',
  13500: '13500-v-bucks',
};

interface CapturedEntry {
  id: number;
  timestamp: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  postData: string | null;
  resourceType: string;
  status: number | null;
  responseHeaders: Record<string, string> | null;
  responseBody: string | null;
  isCritical: boolean;
  domain: string;
  durationMs: number | null;
}

class CaptureWithLogin {
  private entries: CapturedEntry[] = [];
  private counter = 0;
  private startTime = Date.now();
  private epicToken: string = '';
  private razerCookiesPath: string = '';
  private amount: number = 2800;
  private outputDir: string;

  constructor() {
    this.outputDir = path.resolve(__dirname);
    this.parseArgs();
  }

  private parseArgs(): void {
    const args = process.argv.slice(2);

    const tokenIdx = args.indexOf('--epic-token');
    if (tokenIdx !== -1) this.epicToken = args[tokenIdx + 1] || '';

    const cookiesIdx = args.indexOf('--razer-cookies');
    if (cookiesIdx !== -1) this.razerCookiesPath = args[cookiesIdx + 1] || '';

    const amountIdx = args.indexOf('--amount');
    if (amountIdx !== -1) this.amount = parseInt(args[amountIdx + 1]) || 2800;

    if (!this.epicToken) {
      console.error('❌ --epic-token обязателен');
      console.error('');
      console.error('Использование:');
      console.error('  npx ts-node src/api-capture/capture-with-login.ts --epic-token <token> [--razer-cookies cookies.json] [--amount 2800]');
      process.exit(1);
    }
  }

  async run(): Promise<void> {
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║     API CAPTURE + AUTO LOGIN — Запись flow покупки          ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log(`║  Amount: ${this.amount} V-Bucks                                      ║`);
    console.log(`║  Token:  ${this.epicToken.substring(0, 20)}...                        ║`);
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log('');

    // 1. Получаем exchange_code из access_token
    console.log('🔑 Получаю exchange_code...');
    const exchangeCode = await this.getExchangeCode();
    console.log(`✅ Exchange code получен (${exchangeCode.length} символов)`);
    console.log('');

    // 2. Запускаем браузер
    const browser = await chromium.launch({
      headless: false,
      args: ['--window-size=1400,900', '--disable-blink-features=AutomationControlled'],
    });

    const context = await browser.newContext({
      viewport: { width: 1400, height: 900 },
      locale: 'tr-TR',
      timezoneId: 'Europe/Istanbul',
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    });

    // Загружаем Razer-куки
    if (this.razerCookiesPath) {
      await this.loadCookies(context);
    }

    // Подключаем перехватчик
    context.on('request', (req) => this.onRequest(req));
    context.on('response', (res) => this.onResponse(res));

    const page = await context.newPage();

    // 3. Логинимся через exchange_code
    console.log('🌐 Логинюсь в Epic через exchange_code...');
    await page.goto(
      `https://www.epicgames.com/id/exchange?exchangeCode=${exchangeCode}`,
      { waitUntil: 'networkidle', timeout: 60000 },
    );
    console.log('✅ Залогинился в Epic');
    console.log('');

    // 4. Открываем страницу товара
    const slug = VBUCKS_SLUGS[this.amount] || '2800-v-bucks-core';
    const productUrl = `https://store.epicgames.com/tr/p/fortnite--${slug}`;
    console.log(`🛒 Открываю ${productUrl}`);
    await page.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    console.log('✅ Страница товара открыта');
    console.log('');
    console.log('📋 ТЕПЕРЬ ВРУЧНУЮ:');
    console.log('   1. Нажми "Satın Al" / "Buy Now"');
    console.log('   2. Выбери Razer Gold Wallet');
    console.log('   3. Нажми "SİPARİŞ VER" / "Place Order"');
    console.log('   4. Подтверди на Razer Gold');
    console.log('   5. Дождись "Order Complete"');
    console.log('   6. Закрой браузер');
    console.log('');
    console.log('📊 Записываю все API-вызовы...');
    console.log('');

    // Сохранение при закрытии
    const saveAndExit = () => {
      this.save();
      process.exit(0);
    };
    process.on('SIGINT', saveAndExit);
    process.on('SIGTERM', saveAndExit);

    await new Promise<void>((resolve) => {
      browser.on('disconnected', () => resolve());
    });

    this.save();
  }

  private async getExchangeCode(): Promise<string> {
    const url = 'https://account-public-service-prod03.ol.epicgames.com/account/api/oauth/exchange';
    const res = await axios.get(url, {
      headers: { Authorization: `Bearer ${this.epicToken}` },
      timeout: 10000,
    });
    if (!res.data?.code) throw new Error('No exchange code in response');
    return res.data.code;
  }

  private async loadCookies(context: BrowserContext): Promise<void> {
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
        console.log(`🍪 Загружено ${normalized.length} кук`);
      }
    } catch (err: any) {
      console.warn(`⚠️  Куки не загружены: ${err.message}`);
    }
  }

  private isInteresting(url: string): boolean {
    return INTERESTING_DOMAINS.some((d) => url.includes(d));
  }

  private isCritical(url: string): boolean {
    return CRITICAL_PATTERNS.some((p) => url.toLowerCase().includes(p));
  }

  private onRequest(request: Request): void {
    const url = request.url();
    if (!this.isInteresting(url)) return;

    const type = request.resourceType();
    if (['image', 'font', 'stylesheet', 'media'].includes(type) && !this.isCritical(url)) return;

    this.counter++;
    const entry: CapturedEntry = {
      id: this.counter,
      timestamp: new Date().toISOString(),
      url,
      method: request.method(),
      headers: request.headers(),
      postData: request.postData() || null,
      resourceType: type,
      status: null,
      responseHeaders: null,
      responseBody: null,
      isCritical: this.isCritical(url),
      domain: (() => { try { return new URL(url).hostname; } catch { return '?'; } })(),
      durationMs: null,
    };

    this.entries.push(entry);

    const icon = entry.isCritical ? '🔴' : '⚪';
    const short = url.length > 90 ? url.substring(0, 90) + '...' : url;
    if (entry.isCritical) {
      console.log(`${icon} [${this.counter}] ${entry.method} ${short}`);
      if (entry.postData) {
        const preview = entry.postData.substring(0, 150);
        console.log(`   📤 Body: ${preview}${entry.postData.length > 150 ? '...' : ''}`);
      }
    }
  }

  private async onResponse(response: Response): Promise<void> {
    const url = response.url();
    if (!this.isInteresting(url)) return;

    const entry = [...this.entries].reverse().find((e) => e.url === url && e.status === null);
    if (!entry) return;

    entry.status = response.status();
    entry.responseHeaders = response.headers();
    entry.durationMs = Date.now() - this.startTime - (entry.id * 10); // approximate

    if (entry.isCritical) {
      try {
        const ct = response.headers()['content-type'] || '';
        if (ct.includes('json') || ct.includes('text') || ct.includes('html')) {
          const body = await response.text().catch(() => null);
          if (body && body.length < 500_000) {
            entry.responseBody = body;
          }
        }
      } catch { /* ignore */ }

      const statusIcon = entry.status >= 200 && entry.status < 400 ? '✅' : '❌';
      console.log(`   ${statusIcon} ${entry.status}`);
      if (entry.responseBody) {
        const preview = entry.responseBody.substring(0, 120);
        console.log(`   📥 Resp: ${preview}${entry.responseBody.length > 120 ? '...' : ''}`);
      }
    }
  }

  private save(): void {
    const allPath = path.join(this.outputDir, 'captured-requests.json');
    const critPath = path.join(this.outputDir, 'captured-critical.json');
    const summaryPath = path.join(this.outputDir, 'captured-summary.txt');

    const critical = this.entries.filter((e) => e.isCritical);

    fs.writeFileSync(allPath, JSON.stringify(this.entries, null, 2));
    fs.writeFileSync(critPath, JSON.stringify(critical, null, 2));

    const lines = critical.map(
      (e) =>
        `[#${e.id}] ${e.method} ${e.url}\n` +
        `  Status: ${e.status}\n` +
        (e.postData ? `  Request Body: ${e.postData.substring(0, 300)}\n` : '') +
        (e.responseBody ? `  Response: ${e.responseBody.substring(0, 300)}\n` : '') +
        ``,
    );

    fs.writeFileSync(
      summaryPath,
      [
        `=== API CAPTURE SUMMARY ===`,
        `Date: ${new Date().toISOString()}`,
        `V-Bucks: ${this.amount}`,
        `Total: ${this.entries.length} requests`,
        `Critical: ${critical.length} API calls`,
        ``,
        `=== FLOW (critical calls in order) ===`,
        ``,
        ...lines,
      ].join('\n'),
    );

    console.log('');
    console.log('═══════════════════════════════════════════');
    console.log(`✅ Записано: ${this.entries.length} запросов (${critical.length} critical)`);
    console.log(`📁 ${allPath}`);
    console.log(`📁 ${critPath}`);
    console.log(`📁 ${summaryPath}`);
    console.log('═══════════════════════════════════════════');
  }
}

new CaptureWithLogin().run().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
