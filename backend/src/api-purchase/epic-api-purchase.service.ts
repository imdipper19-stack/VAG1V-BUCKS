/**
 * EpicApiPurchaseService — гибридная покупка V-Bucks.
 *
 * Стратегия:
 * 1. Browser stealth + login через Epic exchange code (10-30 сек)
 * 2. Открытие checkout page → извлечение session token + JS-driven Talon captcha (5-10 сек)
 * 3. Direct API через context.request: initialize → preview → confirm-order (5 сек)
 * 4. Browser-driven Razer payment: form.submit → login → PROCEED → OTP → CONFIRM (15-30 сек)
 *
 * Среднее время: 50-80 секунд вместо 10 минут.
 */

import { Injectable, Logger, Optional, OnModuleInit } from '@nestjs/common';
import { Browser, BrowserContext, Page } from 'playwright';
import { authenticator } from 'otplib';
import axios from 'axios';
import { CaptchaSolverService } from '../captcha/captcha-solver.service';
import { BrowserPool } from './browser-pool.service';

const VBUCKS_OFFERS: Record<number, string> = {
  800: '90ef336a7c434257bde376b3d3c105ca',
  1000: 'dae36629ab90482f94a6f57711b0ea7a',
  2800: '8bd6fab03bb74c6594322ef2d35b8d2a',
  5000: '0938e28d19bf4fcd83531c0a02f8eed5',
  13500: '09176f4ff7564bbbb499bbe20bd6348f',
};

const PAYMENT_API = 'https://payment-website-pci.ol.epicgames.com';

export interface ApiPurchaseResult {
  success: boolean;
  orderId?: string;
  errorReason?: string;
  errorMessage?: string;
  durationMs?: number;
  /** JSON-строка cookies pay.gold.razer.com / global.gold.razer.com / razerid.razer.com после успешной покупки.
   * Можно сохранить в RazerAccount.sessionCookies чтобы следующий заказ скипнул login form. */
  refreshedRazerCookies?: string;
}

export interface RazerCredentials {
  email: string;
  password: string;
  totpSecret?: string;
}

export interface EpicPurchaseProxy {
  /** http or socks5; e.g. 'http://1.2.3.4:8080' */
  server: string;
  username?: string;
  password?: string;
}

export interface EpicPurchaseParams {
  epicAccessToken: string;
  vbucksAmount: number;
  razerCredentials: RazerCredentials;
  country?: string;
  /** TR-прокси для browser context. Без него Epic вернёт geo_locked_purchasing. */
  proxy?: EpicPurchaseProxy;
  /** Заранее залогиненные cookies Razer Gold аккаунта. Если переданы — скипаем login form (-7 сек). */
  razerSessionCookies?: string;
}

@Injectable()
export class EpicApiPurchaseService implements OnModuleInit {
  private readonly logger = new Logger(EpicApiPurchaseService.name);

  constructor(
    private readonly browserPool: BrowserPool,
    @Optional() private readonly captchaSolver?: CaptchaSolverService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Прогреваем пул в фоне — не блокируем старт Nest
    this.browserPool.warmup().catch((err) =>
      this.logger.warn(`Warmup failed: ${err.message}`),
    );
  }

  async purchase(params: EpicPurchaseParams): Promise<ApiPurchaseResult> {
    const startTime = Date.now();
    const { epicAccessToken, vbucksAmount, razerCredentials, country = 'TR', proxy, razerSessionCookies } = params;

    const offerId = VBUCKS_OFFERS[vbucksAmount];
    if (!offerId) {
      return this.fail('package_not_found', `No offer ID for ${vbucksAmount} V-Bucks`);
    }

    let browser: Browser | null = null;
    let context: BrowserContext | null = null;

    try {
      this.logger.log(`[API] Starting purchase: ${vbucksAmount} V-Bucks (offer: ${offerId})${proxy ? ` via ${proxy.server}` : ' (no proxy!)'}`);

      // === STEP 1: Получаем exchange code ===
      const exchangeResp = await axios.get(
        'https://account-public-service-prod03.ol.epicgames.com/account/api/oauth/exchange',
        { headers: { Authorization: `Bearer ${epicAccessToken}` }, timeout: 10000 },
      );
      const exchangeCode = exchangeResp.data?.code;
      if (!exchangeCode) return this.fail('no_exchange_code', 'Failed to get exchange code');

      // === STEP 2: Browser session (из pool — экономит cold start) ===
      // Прокси задаётся на уровне контекста, не браузера: один browser обслуживает заказы
      // с разными IP/Razer-аккаунтами параллельно.
      browser = await this.browserPool.acquire();

      const contextOptions: any = {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        locale: 'tr-TR',
        timezoneId: 'Europe/Istanbul',
        viewport: { width: 1366, height: 768 },
      };
      if (proxy) {
        contextOptions.proxy = {
          server: proxy.server,
          username: proxy.username,
          password: proxy.password,
        };
      }

      context = await browser.newContext(contextOptions);

      // Если есть готовые Razer cookies — заранее их подсаживаем,
      // чтобы скипнуть login form на pay.gold.razer.com (-5..7 сек).
      if (razerSessionCookies) {
        try {
          const parsed = JSON.parse(razerSessionCookies);
          if (Array.isArray(parsed) && parsed.length > 0) {
            await context!.addCookies(parsed);
            this.logger.log(`[API] Loaded ${parsed.length} Razer cookies (skipping login form)`);
          }
        } catch (err: any) {
          this.logger.warn(`[API] Failed to parse razerSessionCookies: ${err.message}`);
        }
      }

      const page = await context!.newPage();

      // Login через Epic — ждём именно сессионную cookie (EPIC_BEARER_TOKEN или EPIC_SESSION_*),
      // а НЕ EPIC_DEVICE (она ставится сразу до логина и даёт false-positive).
      // Без сессионки store.epicgames.com выдаст "Account id is missing".
      await page.goto(`https://www.epicgames.com/id/exchange?exchangeCode=${exchangeCode}`, {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });

      const loginDeadline = Date.now() + 15000;
      let loggedIn = false;
      while (Date.now() < loginDeadline) {
        const cookies = await context!.cookies('https://www.epicgames.com');
        const hasSession = cookies.some(
          (c) =>
            c.name === 'EPIC_BEARER_TOKEN' ||
            c.name === 'EPIC_SESSION_AP' ||
            c.name === 'EPIC_SESSION_DIESEL' ||
            c.name.startsWith('EPIC_SSO_'),
        );
        if (hasSession) {
          loggedIn = true;
          break;
        }
        await page.waitForTimeout(300);
      }
      if (!loggedIn) {
        // Без сессии checkout 100% упадёт — лучше провалиться сразу
        return this.fail('login_failed', 'Epic session cookie not set after /id/exchange');
      }
      this.logger.log(`[API] Logged in (${((Date.now() - startTime) / 1000).toFixed(1)}s)`);

      // Открываем checkout
      const purchaseUrl = `https://store.epicgames.com/purchase?highlightColor=0078f2&lang=tr&offers=1-fn-${offerId}--&showNavigation=true`;

      let interceptedInitialize: any = null;
      page.on('response', async (response) => {
        if (response.url().endsWith('/v2/purchase/initialize') && response.status() === 200) {
          try { interceptedInitialize = await response.json(); } catch {}
        }
      });

      // domcontentloaded слишком рано (React ещё не смонтирован), networkidle слишком поздно
      // (хвостовая аналитика). load — золотая середина: HTML + все скрипты загружены.
      await page.goto(purchaseUrl, { waitUntil: 'load', timeout: 60000 });

      // Cloudflare check (если редиректнули на challenge)
      const isChallenge = async () => /just a moment|bir dakika|dakika lütfen|checking your browser/i.test(await page.title());
      if (await isChallenge()) {
        this.logger.log('[API] Cloudflare challenge, waiting...');
        const cfStart = Date.now();
        while (await isChallenge() && Date.now() - cfStart < 30000) {
          await page.waitForTimeout(1000);
        }
        if (await isChallenge()) {
          return this.fail('cloudflare_blocked', 'Cloudflare did not auto-resolve');
        }
      }

      this.logger.log(`[API] Checkout page loaded (${((Date.now() - startTime) / 1000).toFixed(1)}s)`);

      // Извлекаем session token из <input id="purchaseToken">
      // Используем locator.waitFor + быстрый полл вместо setTimeout(2000) × 8 = 16с
      let xRequestedWith = '';
      try {
        await page.locator('#purchaseToken').first().waitFor({ state: 'attached', timeout: 25000 });
        xRequestedWith = await page.evaluate(() => {
          const el = document.getElementById('purchaseToken') as HTMLInputElement | null;
          return el?.value || '';
        });

        // Если value ещё пустое — дожидаемся пока React его не наполнит (полл 100мс)
        if (!xRequestedWith) {
          const valDeadline = Date.now() + 15000;
          while (Date.now() < valDeadline && !xRequestedWith) {
            await page.waitForTimeout(150);
            xRequestedWith = await page.evaluate(() => {
              const el = document.getElementById('purchaseToken') as HTMLInputElement | null;
              return el?.value || '';
            }).catch(() => '');
          }
        }
      } catch {
        // fallback ниже
      }

      if (!xRequestedWith) {
        const html = await page.content();
        const m = html.match(/id=["']purchaseToken["'][^>]*value=["']([a-f0-9]{32})["']/i);
        if (m) xRequestedWith = m[1];
      }

      if (!xRequestedWith) {
        // Сохраняем диагностику чтобы увидеть в каком состоянии застряла страница
        try {
          const ts = Date.now();
          await page.screenshot({ path: `./screenshots/no-token-${ts}.png`, fullPage: true });
          const html = await page.content();
          const fs = require('fs');
          fs.writeFileSync(`./screenshots/no-token-${ts}.html`, html);
          this.logger.warn(`[API] no_session_token diag: ./screenshots/no-token-${ts}.{png,html}, url=${page.url().substring(0, 120)}, title=${await page.title()}`);
        } catch {}
        return this.fail('no_session_token', 'purchaseToken input not found');
      }

      this.logger.log(`[API] Session token: ${xRequestedWith.substring(0, 16)}... (${((Date.now() - startTime) / 1000).toFixed(1)}s)`);

      // === STEP 3: API calls через context.request ===
      const request = context!.request;
      const apiHeaders = {
        'Accept': 'application/json, text/plain, */*',
        'Content-Type': 'application/json',
        'Referer': purchaseUrl,
        'x-requested-with': xRequestedWith,
        'sec-ch-ua': '"Chromium";v="131", "Not.A/Brand";v="8"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
      };

      const apiCall = async (method: 'GET' | 'POST', path: string, body?: any) => {
        const url = `${PAYMENT_API}${path}`;
        const opts: any = { headers: apiHeaders };
        if (body) opts.data = body;
        const resp = method === 'GET' ? await request.get(url, opts) : await request.post(url, opts);
        if (!resp.ok()) {
          const text = await resp.text();
          throw new Error(`${resp.status()}: ${text.substring(0, 300)}`);
        }
        return resp.json();
      };

      // 1. Initialize
      const initWait = Date.now();
      while (!interceptedInitialize && Date.now() - initWait < 15000) {
        await page.waitForTimeout(500);
      }

      let initData = interceptedInitialize;
      if (!initData) {
        try { initData = await apiCall('GET', '/v2/purchase/initialize'); } catch {}
      }
      if (!initData?.offers) {
        return this.fail('init_failed', `Initialize: ${JSON.stringify(initData || {}).substring(0, 200)}`);
      }
      this.logger.log('[API] Initialize OK');

      // 2. Initial preview
      const previewBody = {
        country,
        offers: [offerId],
        lineOffers: [{
          offerId,
          namespace: 'fn',
          quantity: 1,
          ownedSubOffers: [],
          title: '',
          imageUrl: '',
        }],
        salesChannelId: 'Windows-Store-EGSWeb',
        merchantGroup: 'EGS_MKT',
      };

      const initialPreview = await apiCall('POST', '/v2/purchase/initial-preview', previewBody);
      const methods = initialPreview?.paymentMethods?.availablePaymentMethods || [];
      const razerMethod = methods.find((m: any) =>
        (m.paymentMethodType || '').includes('RAZERGOLD') ||
        (m.paymentMethodType || '').includes('RAZER_GOLD') ||
        (m.displayInfo?.displayName || '').toLowerCase().includes('razer'),
      );

      if (!razerMethod) {
        const names = methods.map((m: any) => m.displayInfo?.displayName).join(', ');
        return this.fail('razer_not_available', `Methods: ${names}`);
      }
      this.logger.log(`[API] Razer Gold available (gateway: ${razerMethod.gatewayType})`);

      // 3. Order preview
      const orderBody = {
        ...previewBody,
        paymentMethod: {
          gatewayTypeId: razerMethod.gatewayTypeId,
          gatewayType: razerMethod.gatewayType,
          paymentMethodTypeId: razerMethod.paymentMethodTypeId,
          paymentMethodType: razerMethod.paymentMethodType,
        },
      };

      const preview = await apiCall('POST', '/v2/purchase/order-preview', orderBody);
      if (preview?.orderResponse?.status !== 'PREVIEW') {
        return this.fail('preview_failed', `Status: ${preview?.orderResponse?.status}`);
      }

      const totalAmount = preview?.orderResponse?.lineOffers?.[0]?.price?.discountedPrice?.amount;
      this.logger.log(`[API] Order preview OK: ${(totalAmount || 0) / 100} TRY`);

      // Финальный body для confirm-order
      const cardInfo = {
        paymentMethodType: razerMethod.paymentMethodType,
        merchantId: razerMethod.merchantId || '',
        countryCode: country,
        currency: 'TRY',
      };

      const finalOrderBody: any = {
        country,
        offers: [offerId],
        lineOffers: previewBody.lineOffers,
        namespace: 'fn',
        totalAmount: totalAmount || 0,
        setDefault: false,
        canQuickPurchase: false,
        locale: 'tr',
        interimCommEmail: '',
        redeemRewardAmount: 0,
        cardInfo,
        requireExternalBrowser: false,
        gatewayType: razerMethod.gatewayType,
        paymentMethodType: razerMethod.paymentMethodType,
        paymentMethodSubtype: razerMethod.paymentMethodSubtype || 'RAZER_GOLD_WALLET',
        isOneTimePayment: true,
        billingAddress: {},
        originatingRequest: purchaseUrl,
        affiliateId: '',
        creatorSource: '',
      };

      // 4. Confirm order (с обработкой Talon captcha)
      let confirmResp: any;
      try {
        confirmResp = await apiCall('POST', '/v2/purchase/confirm-order', finalOrderBody);
      } catch (err: any) {
        if (err.message.includes('captcha_required')) {
          this.logger.log('[API] Captcha required, getting Talon token from browser...');
          const talonToken = await this.getTalonToken(page);
          this.logger.log(`[API] Talon token: ${talonToken.substring(0, 30)}...`);

          confirmResp = await apiCall('POST', '/v2/purchase/confirm-order', {
            ...finalOrderBody,
            captchaToken: talonToken,
          });
        } else {
          throw err;
        }
      }

      const orderResp = confirmResp?.orderResponse;
      if (!orderResp?.orderId) {
        return this.fail('confirm_failed', 'No orderId');
      }

      this.logger.log(`[API] Order created: ${orderResp.orderId}, status: ${orderResp.status}`);

      // Если уже completed (например через rewards)
      if (orderResp.status === 'COMPLETED' || orderResp.status === 'FULFILLED') {
        await context!.close().catch(() => {});
        if (browser) this.browserPool.release(browser);
        return { success: true, orderId: orderResp.orderId, durationMs: Date.now() - startTime };
      }

      // Извлекаем Razer URL и payment_token из asyncPaymentResponse
      const action = confirmResp?.asyncPaymentResponse?.action;
      const paymentToken = action?.payload?.payment_token;
      const razerActionUrl = action?.url;

      if (!paymentToken || !razerActionUrl) {
        return this.fail('no_payment_token', `Missing data. Token: ${!!paymentToken}, URL: ${!!razerActionUrl}`);
      }

      this.logger.log(`[API] Payment token: ${paymentToken.substring(0, 20)}...`);

      // === STEP 4: Razer Gold через browser UI ===
      // Сабмитим form в браузере с правильным Razer URL и payment_token
      await page.evaluate(async ({ url, token }) => {
        const form = document.createElement('form');
        form.method = 'POST';
        form.action = url;
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = 'payment_token';
        input.value = token;
        form.appendChild(input);
        document.body.appendChild(form);
        form.submit();
      }, { url: razerActionUrl, token: paymentToken });

      // Ждём редиректа на pay.gold.razer.com/order/{razerOrderId}
      try {
        await page.waitForURL(/pay\.gold\.razer\.com\/order\//, { timeout: 30000 });
      } catch {
        return this.fail('razer_no_order', `Razer redirect failed. URL: ${page.url()}`);
      }

      const razerUrl = page.url();
      const orderMatch = razerUrl.match(/\/order\/([A-Za-z0-9%+=]+)/);
      const razerOrderId = orderMatch?.[1] || '';
      if (!razerOrderId) {
        return this.fail('razer_no_order', `Cannot extract order ID from: ${razerUrl}`);
      }

      this.logger.log(`[API] Razer order: ${razerOrderId.substring(0, 30)}... (${((Date.now() - startTime) / 1000).toFixed(1)}s)`);

      // Razer flow через browser UI
      const razerResult = await this.completeRazerPaymentInBrowser({
        page,
        razerOrderId,
        credentials: razerCredentials,
      });

      if (!razerResult.success) {
        return this.fail(razerResult.errorReason || 'razer_failed', razerResult.errorMessage || 'Razer payment failed');
      }

      // Захватываем Razer cookies после успешной покупки —
      // следующий заказ с этим кошельком скипнет login form.
      let refreshedRazerCookies: string | undefined;
      try {
        const cookies = await context!.cookies([
          'https://pay.gold.razer.com',
          'https://global.gold.razer.com',
          'https://razerid.razer.com',
        ]);
        // Фильтруем только важные сессионные cookies, отбрасываем аналитику/cf
        const sessionCookies = cookies.filter((c) =>
          !/^_ga|^_gid|^_gcl_|^_fbp|^_clck|^_clsk|^cky|^__cf_bm|^OptanonConsent/i.test(c.name),
        );
        if (sessionCookies.length > 0) {
          refreshedRazerCookies = JSON.stringify(sessionCookies);
          this.logger.log(`[API] Captured ${sessionCookies.length} Razer session cookies`);
        }
      } catch (err: any) {
        this.logger.warn(`[API] Failed to capture Razer cookies: ${err.message}`);
      }

      const duration = Date.now() - startTime;
      this.logger.log(`[API] ✅ Complete in ${(duration / 1000).toFixed(1)}s`);

      return {
        success: true,
        orderId: orderResp.orderId,
        durationMs: duration,
        refreshedRazerCookies,
      };

    } catch (error: any) {
      this.logger.error(`[API] Fatal: ${error.message}`);
      return this.fail('fatal', error.message);
    } finally {
      if (context) await context.close().catch(() => {});
      if (browser) this.browserPool.release(browser);
    }
  }

  /**
   * Получает Talon captcha token напрямую из window.talon в браузере.
   * Браузер уже загрузил Talon JS — он сам решает challenge.
   */
  private async getTalonToken(page: Page): Promise<string> {
    return page.evaluate(async () => {
      return new Promise<string>((resolve, reject) => {
        const w = window as any;
        const talon = w.talon || (w.__epic_web_purchase_dataPreload && w.__epic_web_purchase_dataPreload.talon);

        if (!talon) {
          reject(new Error('Talon not loaded'));
          return;
        }

        const flowNames = Object.keys(talon.flows || {});
        if (flowNames.length === 0) {
          reject(new Error('No talon flows'));
          return;
        }

        const flowName = flowNames[0];
        const flow = talon.flows[flowName];

        flow.config = flow.config || {};
        flow.config.onComplete = (token: string) => resolve(token);
        flow.config.onError = (e: any) => reject(new Error('Talon error: ' + JSON.stringify(e)));
        flow.config.onExpired = () => reject(new Error('Talon expired'));
        flow.config.onClosed = () => reject(new Error('Talon closed'));

        if (flow.ready) {
          talon.execute(flowName);
        } else {
          flow.config.onReady = () => talon.execute(flowName);
        }

        setTimeout(() => reject(new Error('Talon timeout')), 60000);
      });
    });
  }

  // ─────────────────────────────────────────────────────────────
  // RAZER GOLD через browser UI (как реальный пользователь)
  // ─────────────────────────────────────────────────────────────

  private async completeRazerPaymentInBrowser(params: {
    page: Page;
    razerOrderId: string;
    credentials: RazerCredentials;
  }): Promise<{ success: boolean; errorReason?: string; errorMessage?: string }> {
    const { page, razerOrderId, credentials } = params;

    try {
      // Ждём минимально — networkidle не используем, он может зависнуть из-за аналитики
      await page.waitForTimeout(3000);
      this.logger.log(`[Razer] Order page: ${page.url().substring(0, 100)}`);

      // 1. Закрыть cookie banner если есть
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button, a'));
        for (const b of btns) {
          const t = (b.textContent || '').toLowerCase().trim();
          if (/^accept all$|^accept$|^ok$|^tamam$/i.test(t)) {
            (b as HTMLElement).click();
            return true;
          }
        }
        return false;
      }).catch(() => {});
      await page.waitForTimeout(500);

      // 2. Если виден login form (как часто бывает) — заполняем
      const needsLogin = await page.evaluate(() => {
        const passwords = Array.from(document.querySelectorAll('input[type="password"]')) as HTMLInputElement[];
        for (const pwd of passwords) {
          const r = pwd.getBoundingClientRect();
          const style = window.getComputedStyle(pwd);
          if (r.width > 0 && r.height > 0 && style.display !== 'none' && style.visibility !== 'hidden') {
            return true;
          }
        }
        return false;
      }).catch(() => false);

      if (needsLogin) {
        this.logger.log('[Razer] Login form detected — filling credentials');

        // Email
        const emailInput = page.locator('input[type="email"]:visible, input[name*="email" i]:visible, input[placeholder*="example@razer" i]').first();
        await emailInput.fill(credentials.email).catch(async () => {
          // Fallback — любой первый видимый text input
          await page.locator('input[type="text"]:visible').first().fill(credentials.email).catch(() => {});
        });

        await page.waitForTimeout(300);

        // Password
        await page.locator('input[type="password"]:visible').first().fill(credentials.password);
        await page.waitForTimeout(500);

        // Кнопка LOG IN — ищем напрямую по тексту, без сложного evaluate
        const loginClicked = await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button, input[type=submit], a'));
          for (const btn of btns) {
            const r = (btn as HTMLElement).getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;

            const text = (btn.textContent || (btn as HTMLInputElement).value || '').trim().toLowerCase();
            const id = ((btn as HTMLElement).id || '').toLowerCase();

            // Точное совпадение, исключая promo/apply
            if (id.includes('promo') || id.includes('apply') || text.includes('apply')) continue;

            if (text === 'log in' || text === 'login' || text === 'sign in' || text === 'signin') {
              (btn as HTMLElement).click();
              return { clicked: 'text:' + text };
            }
          }
          return { clicked: null };
        }).catch(() => ({ clicked: null }));

        this.logger.log(`[Razer] Login clicked: ${JSON.stringify(loginClicked)}`);

        // Ждём пока залогинимся (страница перезагрузится или появится 2FA)
        await page.waitForTimeout(5000);

        // Если есть 2FA после логина — заполняем
        const has2FAAfterLogin = await page.evaluate(() => {
          const inp = document.getElementById('code-razer-1') as HTMLInputElement | null;
          if (!inp) return false;
          const r = inp.getBoundingClientRect();
          return r.width > 0;
        }).catch(() => false);

        if (has2FAAfterLogin) {
          this.logger.log('[Razer] 2FA detected after login');
          if (!credentials.totpSecret) {
            return { success: false, errorReason: 'no_totp', errorMessage: 'TOTP secret required' };
          }

          const code = authenticator.generate(credentials.totpSecret.replace(/\s/g, '').toUpperCase());

          await page.evaluate((args: { code: string }) => {
            for (let i = 1; i <= 6; i++) {
              const inp = document.getElementById(`code-razer-${i}`) as HTMLInputElement | null;
              if (inp) {
                inp.value = args.code[i - 1];
                inp.dispatchEvent(new Event('input', { bubbles: true }));
                inp.dispatchEvent(new Event('change', { bubbles: true }));
                inp.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: args.code[i - 1] }));
              }
            }
          }, { code }).catch(() => {});

          await page.waitForTimeout(3000);
        }

        await page.waitForTimeout(2000);
      } else {
        this.logger.log('[Razer] Already logged in (no login form visible)');
      }

      // 3. Ищем PROCEED TO CHECKOUT кнопку
      this.logger.log('[Razer] Looking for PROCEED TO CHECKOUT...');

      let proceedClicked = false;
      const proceedDeadline = Date.now() + 60000; // 60 sec — Razer JS грузится медленно

      while (!proceedClicked && Date.now() < proceedDeadline) {
        // Проверяем не на error/complete
        const cur = page.url();
        if (/\/Order\/Complete/i.test(cur)) {
          this.logger.log('[Razer] ✅ Already complete!');
          return { success: true };
        }
        if (/\/Error/i.test(cur)) {
          break;
        }

        // Находим PROCEED через JS — несколько способов
        const result = await page.evaluate(() => {
          const w = window as any;

          // Способ 1: jQuery .btnConfirm
          if (typeof w.$ === 'function') {
            const $ = w.$;
            const candidates = ['#btnConfirm', '.btnConfirm', '#nextButton', 'button.btn-success'];
            for (const sel of candidates) {
              const el = $(sel);
              if (el.length > 0 && el.is(':visible') && !el.prop('disabled')) {
                el[0].click();
                return { clicked: sel };
              }
            }
          }

          // Способ 2: text-based
          const allBtns = Array.from(document.querySelectorAll('button, a, input[type=submit]'));
          for (const btn of allBtns) {
            const r = (btn as HTMLElement).getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            const t = (btn.textContent || (btn as HTMLInputElement).value || '').toLowerCase().trim();
            if (/proceed to checkout|sipariş ver|onayla|^next$|^continue$/i.test(t)) {
              (btn as HTMLElement).click();
              return { clicked: 'text:' + t };
            }
          }

          return { clicked: null };
        }).catch(() => ({ clicked: null }));

        if (result.clicked) {
          proceedClicked = true;
          this.logger.log(`[Razer] Clicked PROCEED via: ${result.clicked}`);
          break;
        }

        await page.waitForTimeout(2000);
      }

      if (!proceedClicked) {
        // Диагностика
        try {
          const screenshotPath = `./screenshots/razer-no-proceed-${Date.now()}.png`;
          await page.screenshot({ path: screenshotPath, fullPage: true });
          this.logger.warn(`[Razer] Diagnostic screenshot: ${screenshotPath}`);

          const buttons = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('button, a')).slice(0, 30).map(b => {
              const r = (b as HTMLElement).getBoundingClientRect();
              return {
                text: (b.textContent || '').trim().substring(0, 50),
                id: (b as HTMLElement).id,
                cls: (b as HTMLElement).className,
                visible: r.width > 0 && r.height > 0,
              };
            }).filter(b => b.visible);
          });
          this.logger.warn(`[Razer] Visible buttons: ${JSON.stringify(buttons)}`);
        } catch {}
        return { success: false, errorReason: 'razer_no_proceed', errorMessage: 'PROCEED TO CHECKOUT button not found' };
      }

      // 4. Ждём появления OTP формы (или сразу confirm экрана)
      // Razer рендерит OTP внутри cross-origin iframe #razerOTP с src=razerid.razer.com/otp.
      // Подписываемся на frameattached/framenavigated чтобы среагировать сразу при появлении iframe.
      this.logger.log('[Razer] Waiting for OTP form (event-driven + iframes)...');

      const detectInFrame = async (frame: import('playwright').Frame): Promise<{ strategy: 'code-razer' | 'visible-singles'; count: number } | null> => {
        return frame.evaluate(() => {
          // Способ 1: code-razer-1..6
          const ids: string[] = [];
          for (let i = 1; i <= 6; i++) {
            const inp = document.getElementById(`code-razer-${i}`) as HTMLInputElement | null;
            if (inp) {
              const r = inp.getBoundingClientRect();
              if (r.width > 0 && r.height > 0) ids.push(`code-razer-${i}`);
            }
          }
          if (ids.length === 6) return { strategy: 'code-razer' as const, count: 6 };

          // Способ 2: 6 видимых single-char input'ов
          const all = Array.from(document.querySelectorAll('input')) as HTMLInputElement[];
          const candidates = all.filter((inp) => {
            const r = inp.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) return false;
            const ml = inp.getAttribute('maxlength');
            const t = (inp.type || '').toLowerCase();
            if (t === 'hidden' || t === 'checkbox' || t === 'radio' || t === 'submit' || t === 'button') return false;
            return ml === '1' || ml === '2';
          });
          if (candidates.length >= 6) return { strategy: 'visible-singles' as const, count: candidates.length };

          return null;
        }).catch(() => null);
      };

      let otpFrame: import('playwright').Frame | null = null;
      let otpStrategy: 'code-razer' | 'visible-singles' | null = null;

      const otpFoundPromise = new Promise<void>((resolve) => {
        let resolved = false;
        const settle = (frame: import('playwright').Frame, strategy: 'code-razer' | 'visible-singles') => {
          if (resolved) return;
          resolved = true;
          otpFrame = frame;
          otpStrategy = strategy;
          resolve();
        };

        const onFrame = async (frame: import('playwright').Frame) => {
          if (resolved) return;
          // Razer OTP iframe всегда на razerid.razer.com
          if (!/razerid\.razer\.com|pay\.gold\.razer\.com/.test(frame.url())) return;
          // Frame только что появился — подождём пока DOM не отрендерится
          for (let i = 0; i < 20 && !resolved; i++) {
            const detected = await detectInFrame(frame);
            if (detected) {
              settle(frame, detected.strategy);
              return;
            }
            await new Promise((r) => setTimeout(r, 200));
          }
        };

        page.on('frameattached', onFrame);
        page.on('framenavigated', onFrame);

        // Сразу проверяем все уже существующие frames (вдруг iframe был там до клика)
        (async () => {
          while (!resolved) {
            for (const f of page.frames()) {
              if (resolved) break;
              const detected = await detectInFrame(f);
              if (detected) {
                settle(f, detected.strategy);
                return;
              }
            }
            await new Promise((r) => setTimeout(r, 300));
          }
        })();
      });

      // Параллельно ждём либо OTP, либо complete/error URL, либо timeout
      const otpDeadline = 30000;
      const result = await Promise.race([
        otpFoundPromise.then(() => 'otp' as const),
        (async () => {
          const start = Date.now();
          while (Date.now() - start < otpDeadline) {
            const u = page.url();
            if (/\/Order\/Complete|order\/complete/i.test(u)) return 'complete' as const;
            if (/\/Error/i.test(u)) return 'error' as const;
            await page.waitForTimeout(300);
          }
          return 'timeout' as const;
        })(),
      ]);

      if (result === 'complete') {
        this.logger.log('[Razer] ✅ Already completed without OTP!');
        return { success: true };
      }
      if (result === 'error') {
        // упадёт ниже на error URL handling
      }
      if (result === 'timeout') {
        this.logger.warn('[Razer] OTP wait timed out');
      }

      // Диагностика если так и не нашли OTP
      if (!otpFrame || !otpStrategy) {
        try {
          const ts = Date.now();
          await page.screenshot({ path: `./screenshots/razer-no-otp-${ts}.png`, fullPage: true });
          const html = await page.content();
          const fs = require('fs');
          fs.writeFileSync(`./screenshots/razer-no-otp-${ts}.html`, html);

          // Дамп iframes
          const frameDump = page.frames().map((f) => ({ url: f.url().substring(0, 120), name: f.name() }));
          this.logger.warn(`[Razer] Frames at OTP wait: ${JSON.stringify(frameDump)}`);

          // Дамп видимых inputs во всех frames
          const allInputs: any[] = [];
          for (const f of page.frames()) {
            const inFrame = await f.evaluate(() => {
              return Array.from(document.querySelectorAll('input')).map((i) => {
                const r = i.getBoundingClientRect();
                return {
                  id: i.id,
                  name: i.getAttribute('name'),
                  type: i.type,
                  maxlength: i.getAttribute('maxlength'),
                  visible: r.width > 0 && r.height > 0,
                };
              }).filter((i) => i.visible).slice(0, 12);
            }).catch(() => [] as any[]);
            allInputs.push({ frame: f.url().substring(0, 60), inputs: inFrame });
          }
          this.logger.warn(`[Razer] Inputs by frame: ${JSON.stringify(allInputs)}`);
        } catch {}
      }

      // 5. Заполняем OTP если форма найдена
      if (otpFrame && otpStrategy) {
        if (!credentials.totpSecret) {
          return { success: false, errorReason: 'no_totp', errorMessage: 'TOTP secret required' };
        }

        // Локальные const'ы — снимаем TS narrowing к never (otpFrame перезаписывается в замыкании выше)
        const targetFrame: import('playwright').Frame = otpFrame;
        const strategy: 'code-razer' | 'visible-singles' = otpStrategy;

        const otpCode = authenticator.generate(credentials.totpSecret.replace(/\s/g, '').toUpperCase());
        this.logger.log(`[Razer] TOTP: ${otpCode}`);

        // Заполняем непосредственно в нужном frame
        const fillResult = await targetFrame.evaluate((args: { code: string; method: string }) => {
          const filled: string[] = [];
          let inputs: HTMLInputElement[];

          if (args.method === 'code-razer') {
            inputs = [];
            for (let i = 1; i <= 6; i++) {
              const inp = document.getElementById(`code-razer-${i}`) as HTMLInputElement | null;
              if (inp) inputs.push(inp);
            }
          } else {
            const all = Array.from(document.querySelectorAll('input')) as HTMLInputElement[];
            inputs = all.filter((inp) => {
              const r = inp.getBoundingClientRect();
              if (r.width === 0 || r.height === 0) return false;
              const ml = inp.getAttribute('maxlength');
              const t = (inp.type || '').toLowerCase();
              if (t === 'hidden' || t === 'checkbox' || t === 'radio' || t === 'submit' || t === 'button') return false;
              return ml === '1' || ml === '2';
            }).slice(0, 6);
          }

          // Эмулируем ввод как реальный пользователь, чтобы Razer JS-handler'ы видели каждое нажатие
          for (let i = 0; i < 6 && i < inputs.length; i++) {
            const inp = inputs[i];
            try { inp.focus(); } catch {}
            // Используем native value setter, иначе React/Vue игнорируют изменение
            const proto = Object.getPrototypeOf(inp);
            const desc = Object.getOwnPropertyDescriptor(proto, 'value');
            if (desc && desc.set) {
              desc.set.call(inp, args.code[i]);
            } else {
              inp.value = args.code[i];
            }
            inp.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: args.code[i] }));
            inp.dispatchEvent(new Event('input', { bubbles: true }));
            inp.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: args.code[i] }));
            inp.dispatchEvent(new Event('change', { bubbles: true }));
            filled.push(inp.id || `idx-${i}`);
          }

          return filled;
        }, { code: otpCode, method: strategy }).catch((err) => {
          this.logger.warn(`[Razer] OTP evaluate failed: ${err?.message || err}`);
          return [] as string[];
        });

        this.logger.log(`[Razer] OTP filled fields: ${fillResult.length} (${fillResult.join(', ')})`);

        // Fallback: эмулируем клавиатуру в нужном frame через FrameLocator
        if (fillResult.length < 6) {
          this.logger.warn('[Razer] Direct fill incomplete, trying keyboard fallback');
          try {
            // Кликаем на первое видимое поле
            const firstSel = strategy === 'code-razer'
              ? '#code-razer-1'
              : 'input[maxlength="1"]:visible';

            // Если frame == mainFrame, используем page.locator, иначе frame.locator
            const isMain = targetFrame === page.mainFrame();
            if (isMain) {
              const loc = page.locator(firstSel).first();
              await loc.click({ timeout: 3000 });
            } else {
              const fl = page.frameLocator(`iframe[src*="${targetFrame.url().split('?')[0].split('/').pop() || ''}"]`).locator(firstSel).first();
              await fl.click({ timeout: 3000 });
            }
            await page.keyboard.type(otpCode, { delay: 80 });
          } catch (kbErr: any) {
            this.logger.warn(`[Razer] Keyboard fallback failed: ${kbErr.message}`);
          }
        }

        await page.waitForTimeout(2500);

        // 6. Submit OTP. Razer iframe ОБЫЧНО автосабмитит сам через postMessage,
        // но на всякий случай ищем кнопку verify/confirm в этом же frame.
        const otpConfirmClicked = await targetFrame.evaluate(() => {
          const w = window as any;
          if (typeof w.$ === 'function') {
            const $ = w.$;
            const candidates = ['#btnVerify', '#btnSubmit', '.btnConfirm:visible', '#btnConfirm:visible', '#nextButton:visible', 'button[type=submit]:visible'];
            for (const sel of candidates) {
              const el = $(sel);
              if (el.length > 0 && el.is(':visible') && !el.prop('disabled')) {
                el[0].click();
                return sel;
              }
            }
          }
          const btns = Array.from(document.querySelectorAll('button:not([disabled])'));
          for (const btn of btns) {
            const r = (btn as HTMLElement).getBoundingClientRect();
            if (r.width === 0) continue;
            const t = (btn.textContent || '').toLowerCase().trim();
            if (/^confirm$|^pay$|^pay now$|^submit$|^verify$|^next$|onayla|tamam/i.test(t)) {
              (btn as HTMLElement).click();
              return 'text:' + t;
            }
          }
          return null;
        }).catch(() => null);

        this.logger.log(`[Razer] OTP confirm clicked: ${otpConfirmClicked || 'auto-submit (Razer JS via postMessage)'}`);
      }

      // 7. Ждём финальный результат
      this.logger.log('[Razer] Waiting for Order/Complete redirect...');
      const startWait = Date.now();
      while (Date.now() - startWait < 90000) {
        const url = page.url();
        if (/\/Order\/Complete|order\/complete/i.test(url)) {
          this.logger.log(`[Razer] ✅ Payment completed! URL: ${url.substring(0, 100)}`);
          return { success: true };
        }
        if (/\/Error/i.test(url)) {
          const errorText = await page.evaluate(() => {
            const el = document.querySelector('#errorMessage, .error-message, .alert-danger, .error-content');
            return el?.textContent?.trim() || '';
          }).catch(() => '');
          return { success: false, errorReason: 'razer_error_page', errorMessage: `URL: ${url}, Error: ${errorText.substring(0, 200)}` };
        }
        await page.waitForTimeout(2000);
      }

      return { success: false, errorReason: 'razer_timeout', errorMessage: `Timeout. URL: ${page.url()}` };

    } catch (error: any) {
      this.logger.error(`[Razer] ${error.message}`);
      return { success: false, errorReason: 'razer_error', errorMessage: error.message };
    }
  }

  private async findLoginButton(page: Page) {
    const btnInfo = await page.evaluate(() => {
      const passwords = Array.from(document.querySelectorAll('input[type="password"]'))
        .filter((el) => {
          const r = (el as HTMLElement).getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        });
      if (passwords.length === 0) return null;

      const pwd = passwords[0] as HTMLElement;
      let container: HTMLElement | null = pwd.closest('form');
      if (!container) {
        let parent = pwd.parentElement;
        while (parent && parent.tagName !== 'BODY') {
          const submits = parent.querySelectorAll('button[type="submit"], button');
          if (submits.length > 0 && submits.length < 5) {
            container = parent;
            break;
          }
          parent = parent.parentElement;
        }
      }
      if (!container) return null;

      const buttons = Array.from(container.querySelectorAll('button'));
      const cands = buttons.filter((b) => {
        const r = b.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        const t = (b.textContent || '').trim().toLowerCase();
        const id = (b.id || '').toLowerCase();
        if (id.includes('promo') || id.includes('apply') || t.includes('apply')) return false;
        return t.includes('log in') || t.includes('login') || t.includes('sign in') || b.getAttribute('type') === 'submit';
      });
      if (cands.length === 0) return null;
      const btn = cands[0];
      return { id: btn.id, text: (btn.textContent || '').trim() };
    }).catch(() => null);

    if (btnInfo?.id) return page.locator(`#${btnInfo.id}`);
    if (btnInfo?.text) return page.locator('button').filter({ hasText: btnInfo.text }).first();
    return page.getByRole('button', { name: /log\s*in|sign\s*in/i }).first();
  }

  private fail(reason: string, message: string): ApiPurchaseResult {
    this.logger.error(`[API] Failed: ${reason} — ${message}`);
    return { success: false, errorReason: reason, errorMessage: message };
  }
}
