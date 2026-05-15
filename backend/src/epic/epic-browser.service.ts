import { Injectable, Logger, Optional } from '@nestjs/common';
import { Browser, BrowserContext, Page } from 'playwright';
import { CaptchaSolverService } from '../captcha/captcha-solver.service';

/**
 * Результат попытки покупки.
 */
export interface PurchaseResult {
  success: boolean;
  screenshotPath?: string;
  errorReason?: PurchaseErrorReason;
  errorMessage?: string;
}

export type PurchaseErrorReason =
  | 'invalid_exchange_code'
  | 'requires_2fa'
  | 'requires_captcha'
  | 'region_restricted'
  | 'package_not_found'
  | 'payment_failed'
  | 'timeout'
  | 'unknown';

export interface ExchangeLoginOptions {
  exchangeCode: string;
  deploymentId?: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const NAV_TIMEOUT_MS = 60_000;
const EPIC_BASE = 'https://www.epicgames.com';

/**
 * Сервис автоматизации Epic Games через Playwright.
 *
 * Использует playwright-extra + puppeteer-extra-plugin-stealth для обхода
 * антибот-детекции. При обнаружении hCaptcha — решает через 2Captcha API.
 */
@Injectable()
export class EpicBrowserService {
  private readonly logger = new Logger(EpicBrowserService.name);

  constructor(
    @Optional() private readonly captchaSolver?: CaptchaSolverService,
  ) {}

  /**
   * Маппинг количества V-Bucks → slug страницы товара в Epic Store.
   */
  private readonly VBUCKS_SLUGS: Record<number, string> = {
    800:   '800-v-bucks-core',
    2400:  '2400-v-bucks-core',
    4500:  '4500-v-bucks-core',
    12500: '12500-v-bucks',
  };

  /**
   * Запустить браузер с playwright-extra + stealth плагином.
   * Stealth убирает все следы автоматизации которые детектирует hCaptcha/Talon.
   */
  async launchBrowser(): Promise<Browser> {
    const headless = process.env.BROWSER_HEADLESS !== 'false';
    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;

    // Используем playwright-extra с stealth плагином
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { chromium } = require('playwright-extra');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const StealthPlugin = require('puppeteer-extra-plugin-stealth');
    chromium.use(StealthPlugin());

    return chromium.launch({
      headless,
      executablePath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--window-size=1366,768',
        '--disable-infobars',
        // Убираем флаги которые детектируются как автоматизация
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
      ],
      ignoreDefaultArgs: ['--enable-automation'],
    });
  }

  /**
   * Создаёт контекст с реалистичным fingerprint.
   * Locale и timezone — турецкие, чтобы Epic Store открывался в TR-регионе.
   */
  async createContext(browser: Browser, proxyConfig?: {
    host: string;
    port: number;
    username?: string;
    password?: string;
    type?: string;
  }): Promise<BrowserContext> {
    const contextOptions: any = {
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      locale: 'tr-TR',
      timezoneId: 'Europe/Istanbul',
      viewport: { width: 1366, height: 768 },
      screen: { width: 1366, height: 768 },
      colorScheme: 'dark',
      extraHTTPHeaders: {
        'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
        'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
      },
    };

    if (proxyConfig) {
      const isSocks = (proxyConfig.type || '').toLowerCase().includes('socks');
      const protocol = isSocks ? 'socks5' : 'http';
      contextOptions.proxy = {
        server: `${protocol}://${proxyConfig.host}:${proxyConfig.port}`,
        ...(proxyConfig.username && !isSocks ? {
          username: proxyConfig.username,
          password: proxyConfig.password,
        } : {}),
      };
      contextOptions.ignoreHTTPSErrors = true;
      this.logger.log(`Using proxy: ${protocol}://${proxyConfig.host}:${proxyConfig.port}`);
    }

    const context = await browser.newContext(contextOptions);

    // Дополнительный stealth-скрипт поверх плагина — для WebGL и permissions
    await context.addInitScript(() => {
      // WebGL vendor/renderer — реалистичные значения Intel
      const getParameter = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function (parameter: number) {
        if (parameter === 37445) return 'Intel Inc.';
        if (parameter === 37446) return 'Intel Iris OpenGL Engine';
        return getParameter.call(this, parameter);
      };

      // Permissions API — headless Chrome возвращает 'denied' для notifications
      const originalQuery = window.navigator.permissions?.query?.bind(window.navigator.permissions);
      if (originalQuery) {
        (window.navigator.permissions as any).query = (parameters: any) => {
          if (parameters.name === 'notifications') {
            return Promise.resolve({ state: 'default', onchange: null } as unknown as PermissionStatus);
          }
          return originalQuery(parameters);
        };
      }

      // Убираем следы Chromedriver
      delete (window as any).$cdc_asdjflasutopfhvcZLmcfl_;
      delete (window as any).$wdc_;
    });

    return context;
  }

  /**
   * Создаёт контекст с предустановленными куками Razer Gold.
   */
  async createContextWithCookies(
    browser: Browser,
    cookiesJson: string,
    proxyConfig?: {
      host: string;
      port: number;
      username?: string;
      password?: string;
      type?: string;
    },
  ): Promise<BrowserContext> {
    const context = await this.createContext(browser, proxyConfig);

    try {
      const cookies = JSON.parse(cookiesJson);
      if (Array.isArray(cookies) && cookies.length > 0) {
        const normalized = cookies.map((c: any) => {
          // Нормализуем sameSite — Playwright принимает только Strict|Lax|None
          let sameSite: 'Strict' | 'Lax' | 'None' = 'Lax';
          const rawSameSite = (c.sameSite || '').toString().toLowerCase();
          if (rawSameSite === 'strict') sameSite = 'Strict';
          else if (rawSameSite === 'none') sameSite = 'None';
          else sameSite = 'Lax';

          return {
            name: c.name,
            value: c.value,
            domain: c.domain || '.razer.com',
            path: c.path || '/',
            httpOnly: c.httpOnly ?? false,
            secure: c.secure ?? true,
            sameSite,
            expires: c.expirationDate || c.expires || -1,
          };
        });
        await context.addCookies(normalized);
        this.logger.log(`Loaded ${normalized.length} Razer Gold cookies into context`);
      }
    } catch (err: any) {
      this.logger.warn(`Failed to parse Razer cookies: ${err.message}`);
    }

    return context;
  }

  /**
   * Проверяет что куки Razer Gold валидны и парсит баланс.
   * Если куки протухли и есть credentials — пытается перелогиниться.
   *
   * @param cookiesJson — JSON строка с куками (опционально)
   * @param credentials — email/password для автологина если куки истекли
   * @returns статус, баланс и (при автологине) свежие куки
   */
  async validateRazerCookies(
    cookiesJson: string,
    credentials?: { email?: string; password?: string; totpSecret?: string },
  ): Promise<{
    valid: boolean;
    username?: string;
    balance?: number;
    currency?: string;
    error?: string;
    refreshedCookies?: string;
  }> {
    let browser: Browser | null = null;
    let context: BrowserContext | null = null;

    try {
      browser = await this.launchBrowser();
      context = cookiesJson
        ? await this.createContextWithCookies(browser, cookiesJson)
        : await this.createContext(browser);
      const page = await context.newPage();

      // Идём на страницу баланса — она требует логин
      await page.goto('https://gold.razer.com/gold/wallet', {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      });
      await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
      await page.waitForTimeout(2000);

      const url = page.url();
      const needsLogin = url.includes('/login') || url.includes('/signin') || await this.detectLoginForm(page);

      // Если куки протухли — пробуем залогиниться через credentials
      if (needsLogin) {
        if (!credentials?.email || !credentials?.password) {
          return { valid: false, error: 'Cookies expired and no credentials provided for re-login' };
        }

        this.logger.log(`Cookies expired, attempting re-login as ${credentials.email}`);
        await this.loginToRazerStandalone(page, credentials.email, credentials.password, credentials.totpSecret);

        // После логина переходим на wallet
        await page.goto('https://gold.razer.com/gold/wallet', {
          waitUntil: 'domcontentloaded',
          timeout: 30_000,
        });
        await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
        await page.waitForTimeout(2000);

        // Проверяем что ещё не на странице логина
        if (await this.detectLoginForm(page)) {
          return { valid: false, error: 'Re-login failed — still on login form' };
        }
      }

      // Парсим баланс через несколько стратегий
      const balanceData = await this.parseRazerBalance(page);

      // Сохраняем свежие куки если был перелогин
      const freshCookies = await context.cookies();
      const refreshedCookies = JSON.stringify(freshCookies.map(c => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        httpOnly: c.httpOnly,
        secure: c.secure,
        sameSite: c.sameSite,
        expirationDate: c.expires,
      })));

      return {
        valid: true,
        username: balanceData.username,
        balance: balanceData.balance,
        currency: balanceData.currency || 'TRY',
        refreshedCookies: needsLogin ? refreshedCookies : undefined,
      };
    } catch (err: any) {
      this.logger.error(`validateRazerCookies failed: ${err.message}`);
      return { valid: false, error: err.message };
    } finally {
      await this.cleanup(browser, context);
    }
  }

  /**
   * Парсит баланс Razer Gold со страницы кошелька.
   * Несколько стратегий — DOM, JSON в скриптах, fetch к API.
   */
  private async parseRazerBalance(page: Page): Promise<{
    username?: string;
    balance?: number;
    currency?: string;
  }> {
    // Стратегия 1: имя пользователя
    let username: string | undefined;
    const usernameSelectors = [
      '[data-testid="username"]',
      '.user-name',
      '.account-name',
      '.profile-name',
      'header [class*="user" i]',
      '[class*="profile-name" i]',
    ];
    for (const sel of usernameSelectors) {
      const text = await page.locator(sel).first().textContent({ timeout: 2000 }).catch(() => null);
      if (text?.trim()) {
        username = text.trim();
        break;
      }
    }

    // Стратегия 2: парсим баланс через JS — ищем элементы с числами и значком ₺ или TL
    const balanceFromDom = await page.evaluate(() => {
      // Все элементы на странице
      const allElements = Array.from(document.querySelectorAll('*'));
      const candidates: { text: string; isVisible: boolean }[] = [];

      for (const el of allElements) {
        const text = (el.textContent || '').trim();
        // Ищем формат вида "1,234.56 TRY", "1.234,56 ₺", "TL 1234.56"
        if (/[\d,.\s]+\s*(TRY|TL|₺)/i.test(text) && text.length < 50) {
          // Проверяем что это лист (нет вложенных элементов с тем же текстом)
          const directText = Array.from(el.childNodes)
            .filter(n => n.nodeType === Node.TEXT_NODE)
            .map(n => n.textContent?.trim() || '')
            .join('');
          if (directText && /[\d,.\s]+\s*(TRY|TL|₺)/i.test(directText)) {
            candidates.push({ text: directText, isVisible: true });
          }
        }
      }

      return candidates.slice(0, 5);
    }).catch(() => []);

    let balance: number | undefined;
    let currency: string | undefined;

    for (const candidate of balanceFromDom) {
      // Извлекаем число
      const match = candidate.text.match(/([\d,.]+)\s*(TRY|TL|₺)/i);
      if (match) {
        // Нормализуем число (заменяем запятые на точки)
        let numStr = match[1];
        // Если есть и точка и запятая — точка тысячи, запятая дробная
        if (numStr.includes('.') && numStr.includes(',')) {
          numStr = numStr.replace(/\./g, '').replace(',', '.');
        } else if (numStr.includes(',')) {
          // Только запятая — может быть дробная или тысячи
          const parts = numStr.split(',');
          if (parts[1] && parts[1].length === 2) {
            numStr = numStr.replace(',', '.');
          } else {
            numStr = numStr.replace(/,/g, '');
          }
        }
        const parsed = parseFloat(numStr);
        if (!isNaN(parsed) && parsed > 0) {
          balance = parsed;
          currency = 'TRY';
          this.logger.log(`Parsed Razer balance from DOM: ${balance} ${currency} (text: "${candidate.text}")`);
          break;
        }
      }
    }

    // Стратегия 3: вызываем API через fetch если DOM не дал результата
    if (balance === undefined) {
      try {
        const apiBalance = await page.evaluate(async () => {
          const endpoints = [
            'https://gold.razer.com/api/wallet/balance',
            'https://gold.razer.com/api/v1/wallet/balance',
            'https://gold.razer.com/gold/api/wallet',
          ];
          for (const url of endpoints) {
            try {
              const res = await fetch(url, { credentials: 'include' });
              if (res.ok) {
                const data = await res.json();
                return data;
              }
            } catch { /* try next */ }
          }
          return null;
        }).catch(() => null);

        if (apiBalance) {
          balance = parseFloat(apiBalance.balance ?? apiBalance.amount ?? apiBalance.value ?? '0');
          currency = apiBalance.currency || 'TRY';
          this.logger.log(`Parsed Razer balance from API: ${balance} ${currency}`);
        }
      } catch { /* ignore */ }
    }

    return { username, balance, currency };
  }

  /**
   * Ищет кнопку логина именно в форме где есть поле пароля.
   * Это позволяет не зацепить кнопку APPLY у поля промокода и подобные.
   *
   * Стратегия:
   * 1. Находим первое видимое поле password
   * 2. Поднимаемся к ближайшей form/section
   * 3. Ищем submit-кнопку внутри неё
   * 4. Если нет — fallback на текстовый поиск "log in"/"sign in"
   */
  private async findLoginButtonNearPassword(page: Page): Promise<import('playwright').Locator> {
    // Сначала пробуем найти кнопку рядом с password через JS
    const buttonInfo = await page.evaluate(() => {
      // Ищем видимое поле password
      const passwords = Array.from(document.querySelectorAll('input[type="password"]'))
        .filter((el) => {
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      if (passwords.length === 0) return null;

      const pwd = passwords[0] as HTMLElement;
      // Поднимаемся к ближайшей form
      let container: HTMLElement | null = pwd.closest('form');
      // Если формы нет — берём ближайший section/div который содержит password
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

      // Ищем submit-кнопки внутри контейнера
      const buttons = Array.from(container.querySelectorAll('button'));
      // Фильтруем — только видимые и не APPLY/PROMO
      const candidates = buttons.filter((btn) => {
        const rect = btn.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        const text = (btn.textContent || '').trim().toLowerCase();
        const id = (btn.id || '').toLowerCase();
        // Исключаем кнопку промо
        if (id.includes('promo') || id.includes('apply')) return false;
        if (text.includes('apply')) return false;
        // Логин-маркеры
        if (text.includes('log in') || text.includes('login') || text.includes('sign in') ||
            text.includes('signin') || btn.getAttribute('type') === 'submit') {
          return true;
        }
        return false;
      });

      if (candidates.length === 0) return null;

      // Возвращаем первый кандидат с уникальным селектором
      const btn = candidates[0];
      const id = btn.id;
      const text = (btn.textContent || '').trim();
      return { id, text };
    }).catch(() => null);

    if (buttonInfo?.id) {
      this.logger.log(`Login button identified by id="${buttonInfo.id}"`);
      return page.locator(`#${buttonInfo.id}`);
    }

    if (buttonInfo?.text) {
      this.logger.log(`Login button identified by text="${buttonInfo.text}"`);
      return page.locator('button').filter({ hasText: buttonInfo.text }).first();
    }

    // Fallback — старая логика, но более строгая
    this.logger.warn('Could not identify login button via JS, using fallback selectors');
    return page
      .getByRole('button', { name: /^\s*log\s*in\s*$/i })
      .or(page.getByRole('button', { name: /^\s*sign\s*in\s*$/i }))
      .or(page.locator('button').filter({ hasText: /^\s*LOGIN\s*$/i }))
      .or(page.locator('button').filter({ hasText: /^\s*Log In\s*$/i }))
      .first();
  }

  /**
   * Standalone-логин на gold.razer.com (для refresh кук).
   * Отличается от loginToRazer тем, что тут полная форма входа,
   * а не embedded на checkout странице.
   */
  private async loginToRazerStandalone(page: Page, email: string, password: string, totpSecret?: string): Promise<void> {
    // Идём на страницу логина
    await page.goto('https://razerid.razer.com/account/login', {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    }).catch(() => {});

    await page.waitForTimeout(2000);

    // Заполняем форму
    const emailField = page.locator('input[type="email"], input[name*="email" i], input[id*="email" i]').first();
    await emailField.waitFor({ state: 'visible', timeout: 10_000 });
    await emailField.fill(email);

    const passwordField = page.locator('input[type="password"]').first();
    await passwordField.waitFor({ state: 'visible', timeout: 5_000 });
    await passwordField.fill(password);

    // Капча если есть
    await this.handleChallenges(page);

    // Кнопка LOGIN — ищем именно рядом с password
    const loginBtn = await this.findLoginButtonNearPassword(page);

    await loginBtn.click();
    await page.waitForTimeout(5000);
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});

    // Ещё одна капча после клика
    await this.handleChallenges(page);

    // Проверяем 2FA
    const needs2FA = await this.detect2FAForm(page);
    if (needs2FA) {
      this.logger.log('2FA required during standalone Razer login');
      if (!totpSecret) {
        throw new Error('Razer requires 2FA but no TOTP secret configured');
      }
      await this.handle2FA(page, totpSecret, './screenshots');
    }
  }

  /**
   * Вход в Epic Games через одноразовый exchange_code.
   */
  async loginWithExchangeCode(
    page: Page,
    { exchangeCode, deploymentId }: ExchangeLoginOptions,
  ): Promise<void> {
    const params = new URLSearchParams({
      exchangeCode,
      ...(deploymentId ? { deploymentId } : {}),
    });
    const url = `${EPIC_BASE}/id/exchange?${params.toString()}`;
    this.logger.debug(`Logging in via exchange code (len=${exchangeCode.length})`);

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    await page.waitForLoadState('networkidle', { timeout: NAV_TIMEOUT_MS }).catch(() => {});
    await page.waitForTimeout(1500 + Math.floor(Math.random() * 1000));

    await this.handleChallenges(page);

    const cookies = await page.context().cookies();
    const hasSession = cookies.some((c) =>
      ['EPIC_SESSION_AP', 'EPIC_SSO', 'EPIC_BEARER_TOKEN'].includes(c.name),
    );

    if (!hasSession) {
      const currentUrl = page.url();
      if (currentUrl.includes('/id/login') || currentUrl.includes('/login')) {
        throw this.purchaseError('invalid_exchange_code', 'Exchange code rejected by Epic Games');
      }
      throw this.purchaseError('unknown', `No Epic session cookies (url: ${currentUrl})`);
    }

    this.logger.debug('Exchange login successful');
  }

  /**
   * Инициирует смену региона на Турцию.
   */
  async initiateRegionChange(page: Page): Promise<{
    alreadyTR: boolean;
    needsConfirmation: boolean;
  }> {
    try {
      await page.goto('https://www.epicgames.com/account/personal', {
        waitUntil: 'domcontentloaded',
        timeout: NAV_TIMEOUT_MS,
      });
      await this.handleChallenges(page);

      const countryField = page.locator('[data-component="CountrySelector"], select[name="country"]').first();
      const currentValue = await countryField.inputValue().catch(() => null);

      if (currentValue === 'TR') {
        return { alreadyTR: true, needsConfirmation: false };
      }

      const editButton = page
        .getByRole('button', { name: /edit|изменить|change/i })
        .or(page.locator('[data-testid="edit-country"]'))
        .first();

      await editButton.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT_MS });
      await editButton.click();

      const countrySelect = page.locator('select[name="country"]').first();
      await countrySelect.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT_MS });
      await countrySelect.selectOption('TR');

      const saveButton = page.getByRole('button', { name: /save|сохранить|confirm/i }).first();
      await saveButton.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT_MS });
      await saveButton.click();

      const codeInput = page.locator('input[name="code"], input[placeholder*="code" i]').first();
      const needsConfirmation = await codeInput
        .waitFor({ state: 'visible', timeout: 10_000 })
        .then(() => true)
        .catch(() => false);

      return { alreadyTR: false, needsConfirmation };
    } catch (err: any) {
      this.logger.warn(`Region change failed: ${err.message}`);
      return { alreadyTR: false, needsConfirmation: false };
    }
  }

  /**
   * Подтверждает смену региона кодом из email.
   */
  async confirmRegionChange(page: Page, confirmationCode: string): Promise<boolean> {
    try {
      const codeInput = page.locator('input[name="code"], input[placeholder*="code" i]').first();
      await codeInput.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT_MS });
      await codeInput.fill(confirmationCode.trim());

      const confirmButton = page.getByRole('button', { name: /confirm|подтвердить|verify/i }).first();
      await confirmButton.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT_MS });
      await confirmButton.click();

      await page.waitForTimeout(2000);
      return true;
    } catch (err: any) {
      this.logger.warn(`Region confirmation failed: ${err.message}`);
      return false;
    }
  }

  /**
   * Покупка V-Bucks в магазине Fortnite.
   * Использует Razer Gold Wallet как метод оплаты.
   * При появлении hCaptcha — решает через 2Captcha.
   */
  async purchaseVBucks(
    page: Page,
    vbucksAmount: number,
    screenshotDir = './screenshots',
    razerCredentials?: { email?: string; password?: string; totpSecret?: string },
  ): Promise<PurchaseResult> {
    try {
      // 1. Открываем страницу товара
      const slug = this.VBUCKS_SLUGS[vbucksAmount];
      if (!slug) {
        return this.failure('package_not_found', `No store URL for ${vbucksAmount} V-Bucks`);
      }

      const productUrl = `https://store.epicgames.com/tr/p/fortnite--${slug}`;
      this.logger.log(`Opening product page: ${productUrl}`);

      await page.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
      await this.handleChallenges(page);
      await page.waitForLoadState('networkidle', { timeout: NAV_TIMEOUT_MS }).catch(() => {});
      await page.waitForTimeout(2000 + Math.floor(Math.random() * 2000));

      const pageTitle = await page.title().catch(() => '');
      if (pageTitle.toLowerCase().includes('not found') || pageTitle.includes('404')) {
        return this.failure('package_not_found', `Product page not found for ${vbucksAmount} V-Bucks`);
      }

      // 2. Кнопка "Buy Now" / "Satın Al"
      // Ждём полной загрузки страницы товара
      await page.waitForLoadState('networkidle', { timeout: NAV_TIMEOUT_MS }).catch(() => {});
      await page.waitForTimeout(3000); // дополнительное ожидание для React-гидрации

      // Логируем что видим на странице для диагностики
      const productPageUrl = page.url();
      const productPageTitle = await page.title().catch(() => '');
      this.logger.log(`Product page loaded: ${productPageUrl} | title: ${productPageTitle}`);

      // Ищем кнопку Buy Now несколькими способами
      const buyButtonSelectors = [
        '[data-testid="purchase-cta-button"]',
        'button[data-testid*="buy"]',
        'button[data-testid*="purchase"]',
      ];

      let buyButton: import('playwright').Locator | null = null;

      // Сначала пробуем data-testid
      for (const sel of buyButtonSelectors) {
        const count = await page.locator(sel).count().catch(() => 0);
        if (count > 0) {
          buyButton = page.locator(sel).first();
          this.logger.log(`Found buy button via selector: ${sel}`);
          break;
        }
      }

      // Если не нашли — ищем по тексту
      if (!buyButton) {
        const textCandidates = [
          page.getByRole('button', { name: /satın al/i }),
          page.getByRole('button', { name: /buy now/i }),
          page.getByRole('button', { name: /купить/i }),
          page.locator('button').filter({ hasText: /satın al|buy now/i }),
        ];
        for (const candidate of textCandidates) {
          const count = await candidate.count().catch(() => 0);
          if (count > 0) {
            buyButton = candidate.first();
            const txt = await buyButton.textContent().catch(() => '');
            this.logger.log(`Found buy button by text: "${txt?.trim()}"`);
            break;
          }
        }
      }

      if (!buyButton) {
        // Последняя попытка — логируем все кнопки для диагностики
        const allButtons = await page.locator('button').all();
        this.logger.log(`No buy button found. Total buttons on page: ${allButtons.length}`);
        for (const btn of allButtons.slice(0, 10)) {
          const txt = await btn.textContent().catch(() => '');
          this.logger.log(`  Button: "${txt?.trim()}"`);
        }
        return this.failure('package_not_found', 'Buy Now button not found on product page');
      }

      const foundBuyButton = buyButton;

      await foundBuyButton.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT_MS });

      // Ждём пока кнопка станет enabled
      await page.waitForFunction(
        () => {
          const btns = Array.from(document.querySelectorAll('button'));
          const btn = btns.find(b => /satın al|buy now/i.test(b.textContent || ''));
          if (btn) return !(btn as HTMLButtonElement).disabled;
          const testBtn = document.querySelector('[data-testid="purchase-cta-button"]') as HTMLButtonElement;
          return testBtn ? !testBtn.disabled : true;
        },
        undefined,
        { timeout: DEFAULT_TIMEOUT_MS },
      ).catch(() => {});

      await this.handleChallenges(page);
      await foundBuyButton.scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(800 + Math.floor(Math.random() * 500));
      await foundBuyButton.hover().catch(() => {});
      await page.waitForTimeout(400 + Math.floor(Math.random() * 400));

      const buttonText = await foundBuyButton.textContent().catch(() => 'unknown');
      this.logger.log(`Clicking Buy button: "${buttonText?.trim()}"`);

      // Пробуем обычный клик
      await foundBuyButton.click({ timeout: DEFAULT_TIMEOUT_MS });
      this.logger.log('Clicked Buy Now — waiting for checkout to load');

      await page.waitForTimeout(3000);
      await this.takeScreenshot(page, screenshotDir, 'after-buy-click').catch(() => {});

      // Проверяем промежуточные страницы Epic которые блокируют checkout
      await this.handleIntermediatePages(page, screenshotDir);

      // Retry через JS если модалка не появилась
      const quickCheck = page.locator('[role="dialog"], [class*="checkout" i]').first();
      const modalAppeared = await quickCheck.isVisible({ timeout: 5000 }).catch(() => false);
      if (!modalAppeared) {
        this.logger.warn('Modal not appeared — retrying with JS click');
        await page.evaluate(() => {
          const btn = document.querySelector('[data-testid="purchase-cta-button"]') as HTMLButtonElement;
          if (btn) btn.click();
        }).catch(() => {});
        await page.waitForTimeout(3000);
      }

      // 3. Ждём checkout — он открывается внутри iframe от payment-website-pci.ol.epicgames.com
      // Скриншот показывает: сначала "Siparişin yükleniyor...", потом форма оплаты
      this.logger.log('Waiting for checkout iframe to load...');
      await page.waitForTimeout(5000); // ждём лоадер "Siparişin yükleniyor..."

      // ДИАГНОСТИКА: логируем все iframe на странице
      const allIframes = await page.locator('iframe').all();
      this.logger.log(`Total iframes on page after Buy click: ${allIframes.length}`);
      for (const iframe of allIframes) {
        const src = await iframe.getAttribute('src').catch(() => 'no-src');
        const id = await iframe.getAttribute('id').catch(() => 'no-id');
        const cls = await iframe.getAttribute('class').catch(() => 'no-class');
        this.logger.log(`  iframe: src="${src}" id="${id}" class="${cls}"`);
      }

      // ДИАГНОСТИКА: логируем все dialog/overlay элементы
      const dialogs = await page.locator('[role="dialog"], dialog, [class*="modal"], [class*="overlay"], [class*="checkout"]').all();
      this.logger.log(`Total dialog/modal elements: ${dialogs.length}`);
      for (const d of dialogs.slice(0, 5)) {
        const tag = await d.evaluate(el => el.tagName).catch(() => '?');
        const cls = await d.getAttribute('class').catch(() => '');
        const visible = await d.isVisible().catch(() => false);
        this.logger.log(`  ${tag} class="${cls?.substring(0, 80)}" visible=${visible}`);
      }

      // Ждём появления iframe с платёжной системой
      // Из логов: src="/purchase?highlightColor=...&lang=tr&offers=..."
      const paymentIframeLocator = page.frameLocator('iframe[src*="/purchase"]');

      // Также проверяем обычный dialog (на случай если не iframe)
      const dialogLocator = page.locator('[role="dialog"]').first();

      // Ждём до 45 секунд пока появится либо iframe либо dialog
      let checkoutFrame: import('playwright').FrameLocator | null = null;
      let useMainPage = false;
      const startTime = Date.now();

      while (Date.now() - startTime < 45_000) {
        await this.handleChallenges(page);

        // Проверяем iframe — src="/purchase?..."
        const iframeCount = await page.locator('iframe[src*="/purchase"]').count().catch(() => 0);
        if (iframeCount > 0) {
          this.logger.log(`Found payment iframe (count: ${iframeCount})`);
          checkoutFrame = paymentIframeLocator;
          break;
        }

        // Проверяем dialog на основной странице
        const dialogVisible = await dialogLocator.isVisible().catch(() => false);
        if (dialogVisible) {
          this.logger.log('Found checkout dialog on main page');
          useMainPage = true;
          break;
        }

        // Проверяем текстовые маркеры на основной странице
        const hasRazerText = await page.getByText(/Razer Gold Wallet/i).count().catch(() => 0);
        const hasSiparisText = await page.getByText(/SİPARİŞ VER/i).count().catch(() => 0);
        if (hasRazerText > 0 || hasSiparisText > 0) {
          this.logger.log('Found checkout content on main page');
          useMainPage = true;
          break;
        }

        await page.waitForTimeout(1000);
      }

      if (!checkoutFrame && !useMainPage) {
        const currentUrl = page.url();
        this.logger.error(`Checkout not found. URL: ${currentUrl}`);
        await this.takeScreenshot(page, screenshotDir, 'no-checkout-modal').catch(() => {});
        throw this.purchaseError('timeout', 'Checkout modal did not appear');
      }

      await this.takeScreenshot(page, screenshotDir, 'checkout-found').catch(() => {});
      this.logger.log(`Checkout found. Using ${checkoutFrame ? 'iframe' : 'main page'}`);
      await page.waitForTimeout(2000);

      // 4. Выбираем Razer Gold Wallet
      // ВАЖНО: элементы находятся ВНУТРИ iframe, page.evaluate() не имеет к ним доступа
      // Используем ТОЛЬКО frameLocator для работы с элементами checkout
      this.logger.log('Selecting Razer Gold Wallet...');

      if (checkoutFrame) {
        // Ищем элемент с текстом "Razer Gold Wallet" внутри iframe
        const razerOption = checkoutFrame.locator('text=Razer Gold Wallet').first();
        await razerOption.waitFor({ state: 'visible', timeout: 15_000 });

        // Кликаем по самому элементу (label/div содержащий текст)
        await razerOption.click();
        this.logger.log('Clicked Razer Gold Wallet text in iframe');

        await page.waitForTimeout(1500);

        // Проверяем — если radio не выбрался, пробуем кликнуть по radio input напрямую
        // Ищем radio кнопку рядом с текстом Razer Gold
        const razerContainer = checkoutFrame.locator('label, div, li').filter({ hasText: /Razer Gold Wallet/ }).last();
        const radioInContainer = razerContainer.locator('input[type="radio"]').first();
        const radioCount = await radioInContainer.count().catch(() => 0);

        if (radioCount > 0) {
          await radioInContainer.click({ force: true });
          this.logger.log('Also clicked radio input directly in iframe');
        }

        await page.waitForTimeout(1500);
      } else {
        // Основная страница (не iframe)
        const razerOption = page.locator('text=Razer Gold Wallet').first();
        await razerOption.waitFor({ state: 'visible', timeout: 15_000 });
        await razerOption.click();
        this.logger.log('Clicked Razer Gold Wallet on main page');
        await page.waitForTimeout(1500);
      }

      await this.takeScreenshot(page, screenshotDir, 'razer-selected').catch(() => {});
      this.logger.log('Razer Gold selection done');

      // 5. Кнопка "SİPARİŞ VER" / "PLACE ORDER"
      this.logger.log('Looking for SİPARİŞ VER / PLACE ORDER button...');

      let placeOrderClicked = false;

      if (checkoutFrame) {
        // Ищем в iframe
        const btnInFrame = checkoutFrame
          .getByRole('button', { name: /sipariş ver|place order/i })
          .or(checkoutFrame.locator('button').filter({ hasText: /SİPARİŞ VER|PLACE ORDER/i }))
          .first();

        await btnInFrame.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT_MS });
        // Ждём enabled
        await page.waitForTimeout(2000);
        await this.handleChallenges(page);
        await btnInFrame.click();
        placeOrderClicked = true;
        this.logger.log('Clicked SİPARİŞ VER in iframe');
      } else {
        // Ищем на основной странице
        const placeOrderButton = page
          .getByRole('button', { name: /sipariş ver/i })
          .or(page.getByRole('button', { name: /place order/i }))
          .or(page.locator('button').filter({ hasText: /SİPARİŞ VER/ }))
          .or(page.locator('button').filter({ hasText: /PLACE ORDER/i }))
          .first();

        await placeOrderButton.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT_MS });

        // Ждём пока кнопка станет enabled (после выбора Razer Gold)
        await page.waitForFunction(
          () => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const btn = buttons.find(b => /sipariş ver|place order/i.test(b.textContent || ''));
            return btn && !(btn as HTMLButtonElement).disabled;
          },
          undefined,
          { timeout: DEFAULT_TIMEOUT_MS },
        ).catch(() => this.logger.warn('Place order button did not become enabled'));

        await this.handleChallenges(page);
        await page.waitForTimeout(600 + Math.floor(Math.random() * 600));
        await placeOrderButton.click();
        placeOrderClicked = true;
        this.logger.log('Clicked SİPARİŞ VER on main page');
      }

      if (!placeOrderClicked) {
        throw this.purchaseError('payment_failed', 'Could not click place order button');
      }

      this.logger.log('Clicked PLACE ORDER — waiting for Razer redirect or success');

      // Сохраняем скриншот сразу после клика для диагностики Razer-страницы
      await page.waitForTimeout(3000);
      await this.takeScreenshot(page, screenshotDir, 'after-place-order').catch(() => {});

      // Логируем URL чтобы понять куда перекинуло
      this.logger.log(`URL after PLACE ORDER click: ${page.url()}`);

      // Пытаемся обработать страницу подтверждения Razer Gold
      await this.confirmRazerPayment(page, screenshotDir, razerCredentials);

      // 6. Проверяем результат после Razer payment flow
      // confirmRazerPayment уже обработал логин, 2FA, и ожидание
      // Проверяем финальный URL — если /Order/Complete/ — оплата прошла
      const finalUrl = page.url();
      this.logger.log(`Final URL after full payment flow: ${finalUrl}`);

      if (finalUrl.includes('/Order/Complete') || finalUrl.includes('/order/complete')) {
        this.logger.log('Payment SUCCESS — confirmed via /Order/Complete URL');
        const screenshotPath = await this.takeScreenshot(page, screenshotDir, 'success');
        return { success: true, screenshotPath };
      }

      // Если вернулись на Epic — оплата тоже могла пройти
      if (finalUrl.includes('epicgames.com') && !finalUrl.includes('/purchase')) {
        this.logger.log('Returned to Epic Store — payment likely completed');
        const screenshotPath = await this.takeScreenshot(page, screenshotDir, 'success');
        return { success: true, screenshotPath };
      }

      // Если всё ещё на Razer но не на Complete — оплата не завершена
      if (finalUrl.includes('razer.com') && !finalUrl.includes('/Order/Complete')) {
        this.logger.warn(`Payment NOT confirmed. Still on Razer: ${finalUrl.substring(0, 80)}`);
        throw this.purchaseError('payment_failed', 'Payment not confirmed by Razer (stuck on payment page)');
      }

      // Fallback — ждём ещё немного
      const successIndicator = page
        .getByText(/thank you|order complete|purchase successful|teşekkürler|başarılı/i)
        .first();

      const appeared = await successIndicator.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false);
      if (appeared) {
        this.logger.log('Success text appeared on page');
        const screenshotPath = await this.takeScreenshot(page, screenshotDir, 'success');
        return { success: true, screenshotPath };
      }

      throw this.purchaseError('timeout', 'Payment result unclear — no success confirmation found');

    } catch (error: any) {
      const screenshotPath = await this.takeScreenshot(page, screenshotDir, 'error').catch(() => undefined);

      if (error.purchaseReason) {
        return {
          success: false,
          errorReason: error.purchaseReason,
          errorMessage: error.message,
          screenshotPath,
        };
      }

      return {
        success: false,
        errorReason: error.name === 'TimeoutError' ? 'timeout' : 'unknown',
        errorMessage: error.message ?? String(error),
        screenshotPath,
      };
    }
  }

  /**
   * Закрытие браузера и контекста.
   */
  async cleanup(browser: Browser | null, context: BrowserContext | null): Promise<void> {
    try { if (context) await context.close(); } catch (err: any) {
      this.logger.warn(`Failed to close context: ${err.message}`);
    }
    try { if (browser) await browser.close(); } catch (err: any) {
      this.logger.warn(`Failed to close browser: ${err.message}`);
    }
  }

  // ---------- private ----------

  /**
   * Подтверждает оплату на стороне Razer Gold.
   * После клика SİPARİŞ VER на Epic, идёт редирект на global.gold.razer.com.
   * Там запрашивается логин (домен другой, куки могут не передаться).
   * Сначала логинимся через email/password, потом подтверждаем оплату.
   */
  private async confirmRazerPayment(
    page: Page,
    screenshotDir: string,
    razerCredentials?: { email?: string; password?: string; totpSecret?: string },
  ): Promise<void> {
    this.logger.log('Looking for Razer Gold confirmation page...');

    // Ждём пока URL изменится на Razer
    const startTime = Date.now();
    let onRazerPage = false;

    while (Date.now() - startTime < 30_000) {
      const url = page.url();
      if (url.includes('razer.com') || url.includes('razergold')) {
        onRazerPage = true;
        this.logger.log(`Reached Razer page: ${url}`);
        break;
      }
      await page.waitForTimeout(1000);
    }

    if (!onRazerPage) {
      this.logger.log('Did not reach Razer page within 30s — checkout may have completed differently');
      return;
    }

    // Ждём загрузки страницы Razer
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(3000);
    await this.takeScreenshot(page, screenshotDir, 'razer-payment-page').catch(() => {});

    // 1. Сначала закрываем cookie-banner если есть
    await this.dismissCookieBanner(page);

    // 2. Обрабатываем капчу если появилась
    await this.handleChallenges(page);

    // 3. Если на странице есть форма логина — логинимся
    const needsLogin = await this.detectLoginForm(page);
    if (needsLogin) {
      this.logger.log('Login form detected on Razer page');

      if (!razerCredentials?.email || !razerCredentials?.password) {
        this.logger.error('Razer credentials not provided — cannot login');
        await this.takeScreenshot(page, screenshotDir, 'razer-login-needed').catch(() => {});
        throw this.purchaseError('payment_failed', 'Razer requires login but credentials not provided');
      }

      await this.loginToRazer(page, razerCredentials.email, razerCredentials.password, screenshotDir, razerCredentials.totpSecret);
    }

    // 4. После логина (или если логин не нужен) — ищем кнопку подтверждения
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(3000);
    await this.handleChallenges(page);

    this.logger.log('Looking for Razer confirm button...');

    const confirmSelectors = [
      // Из скриншота: зелёная кнопка "PROCEED TO CHECKOUT"
      page.getByRole('button', { name: /proceed to checkout/i }),
      page.locator('button').filter({ hasText: /PROCEED TO CHECKOUT/i }),
      page.getByRole('button', { name: /proceed/i }),
      // Другие варианты
      page.getByRole('button', { name: /confirm/i }),
      page.getByRole('button', { name: /^pay$/i }),
      page.getByRole('button', { name: /pay now/i }),
      page.getByRole('button', { name: /complete/i }),
      page.getByRole('button', { name: /onayla/i }),
      page.getByRole('button', { name: /öde/i }),
      page.getByRole('button', { name: /tamam/i }),
      page.locator('[data-testid*="confirm" i]'),
      page.locator('[data-testid*="pay" i]'),
      page.locator('[data-testid*="checkout" i]'),
      // Ссылки-кнопки (a.btn)
      page.locator('a').filter({ hasText: /PROCEED TO CHECKOUT/i }),
      page.locator('a.btn').filter({ hasText: /proceed|checkout/i }),
    ];

    let confirmButton: import('playwright').Locator | null = null;
    for (const candidate of confirmSelectors) {
      const count = await candidate.count().catch(() => 0);
      if (count > 0) {
        const btn = candidate.first();
        const visible = await btn.isVisible().catch(() => false);
        if (visible) {
          confirmButton = btn;
          const txt = await btn.textContent().catch(() => '');
          this.logger.log(`Found Razer confirm button: "${txt?.trim()}"`);
          break;
        }
      }
    }

    if (!confirmButton) {
      const allButtons = await page.locator('button').all();
      this.logger.warn(`No confirm button found on Razer page. Total buttons: ${allButtons.length}`);
      for (const btn of allButtons.slice(0, 15)) {
        const txt = await btn.textContent().catch(() => '');
        const visible = await btn.isVisible().catch(() => false);
        if (visible && txt?.trim()) {
          this.logger.log(`  Button: "${txt.trim()}"`);
        }
      }
      await this.takeScreenshot(page, screenshotDir, 'razer-no-confirm-btn').catch(() => {});
      return;
    }

    await confirmButton.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(800);
    await confirmButton.click();
    this.logger.log('Clicked Razer confirm button');

    // После клика PROCEED TO CHECKOUT — Razer показывает "LOADING..." (может быть hCaptcha)
    // Ждём до 60 секунд пока загрузится и обработается
    this.logger.log('Waiting for Razer payment processing (up to 60s)...');

    for (let i = 0; i < 12; i++) {
      await page.waitForTimeout(5000);

      // Проверяем 2FA — может появиться ПОСЛЕ клика PROCEED TO CHECKOUT
      const needs2FANow = await this.detect2FAForm(page);
      if (needs2FANow) {
        this.logger.log('2FA form appeared after PROCEED TO CHECKOUT — filling code');
        if (razerCredentials?.totpSecret) {
          await this.handle2FA(page, razerCredentials.totpSecret, screenshotDir);
          // После 2FA ждём результат
          await page.waitForTimeout(5000);
          continue;
        } else {
          this.logger.error('2FA required but no TOTP secret');
          throw this.purchaseError('requires_2fa', 'Razer requires 2FA for payment confirmation but no TOTP secret configured');
        }
      }

      // Проверяем hCaptcha — если появилась, решаем
      // На Razer checkout hCaptcha может иметь другой sitekey
      const hcaptchaOnRazer = await page.locator('iframe[src*="hcaptcha"], [data-hcaptcha-widget-id], .h-captcha, #hcaptcha-container').count().catch(() => 0);
      if (hcaptchaOnRazer > 0) {
        this.logger.log('hCaptcha detected on Razer payment page — solving...');
        // Извлекаем sitekey из страницы
        const razerSitekey = await page.evaluate(() => {
          const hcaptchaDiv = document.querySelector('.h-captcha, [data-hcaptcha-widget-id], [data-sitekey]');
          if (hcaptchaDiv) return hcaptchaDiv.getAttribute('data-sitekey');
          // Ищем в iframe src
          const iframe = document.querySelector('iframe[src*="hcaptcha"]');
          if (iframe) {
            const src = iframe.getAttribute('src') || '';
            const match = src.match(/sitekey=([a-f0-9-]+)/);
            return match ? match[1] : null;
          }
          return null;
        }).catch(() => null);

        const sitekey = razerSitekey || CaptchaSolverService.EPIC_HCAPTCHA_SITEKEY;
        this.logger.log(`Razer hCaptcha sitekey: ${sitekey}`);

        if (this.captchaSolver) {
          try {
            const userAgent = await page.evaluate(() => navigator.userAgent).catch(() => undefined);
            const token = await this.captchaSolver.solveHCaptcha(sitekey, page.url(), userAgent);

            // Вставляем токен
            await page.evaluate((captchaToken) => {
              const responseField = document.querySelector('[name="h-captcha-response"], [name="g-recaptcha-response"]') as HTMLTextAreaElement;
              if (responseField) responseField.value = captchaToken;
              // Триггерим callback
              const hcaptchaWidget = (window as any).hcaptcha;
              if (hcaptchaWidget && typeof hcaptchaWidget.execute === 'function') {
                try { hcaptchaWidget.execute(); } catch { /* ignore */ }
              }
            }, token);

            this.logger.log('Razer hCaptcha solved and token injected');
            await page.waitForTimeout(3000);
          } catch (captchaErr: any) {
            this.logger.warn(`Failed to solve Razer hCaptcha: ${captchaErr.message}`);
          }
        }
      } else {
        // Стандартная проверка через handleChallenges
        await this.handleChallenges(page);
      }

      // Проверяем — появилась ли страница успеха
      const currentUrl = page.url();

      // Razer Gold: /Order/Complete/ = оплата прошла успешно
      if (currentUrl.includes('/Order/Complete') || currentUrl.includes('/order/complete')) {
        this.logger.log('Payment SUCCESS — Razer redirected to /Order/Complete');
        break;
      }

      const successText = await page.getByText(/payment successful|order completed|thank you|başarılı|tamamlandı/i).count().catch(() => 0);
      if (successText > 0) {
        this.logger.log('Payment success detected on Razer page!');
        break;
      }

      // Проверяем — редирект обратно на Epic (значит оплата прошла)
      if (currentUrl.includes('epicgames.com') && !currentUrl.includes('razer')) {
        this.logger.log('Redirected back to Epic — payment likely completed');
        break;
      }

      // Проверяем — появилась ли ошибка (только в основном контенте, не в футере)
      const errorText = await page.evaluate(() => {
        // Ищем ошибку только в основном блоке (не в footer, не в Terms)
        const mainContent = document.querySelector('main, [role="main"], .content, .order-summary, .checkout-content');
        const searchIn = mainContent || document.body;
        const text = searchIn.textContent || '';
        // Проверяем конкретные фразы ошибки оплаты
        return /insufficient (balance|fund)|payment (failed|declined|error)|transaction (failed|declined)|not enough (gold|balance)/i.test(text);
      }).catch(() => false);

      if (errorText) {
        this.logger.error('Payment error detected on Razer page');
        await this.takeScreenshot(page, screenshotDir, 'razer-payment-error').catch(() => {});
        throw this.purchaseError('payment_failed', 'Razer Gold payment failed (insufficient balance or error)');
      }

      // Проверяем — есть ли ещё одна кнопка подтверждения (CONFIRM / PAY)
      const secondConfirm = page
        .getByRole('button', { name: /^confirm$|^pay$|^pay now$|^complete$/i })
        .or(page.locator('button').filter({ hasText: /^CONFIRM$|^PAY$|^PAY NOW$/i }))
        .first();

      if (await secondConfirm.isVisible({ timeout: 1000 }).catch(() => false)) {
        this.logger.log('Found second confirm button — clicking');
        await secondConfirm.click();
        await page.waitForTimeout(3000);
      }

      this.logger.log(`Still waiting... (${(i + 1) * 5}s elapsed, URL: ${currentUrl.substring(0, 80)})`);
    }

    await page.waitForTimeout(5000);
    await this.takeScreenshot(page, screenshotDir, 'razer-after-confirm').catch(() => {});
    this.logger.log(`Final URL after Razer payment: ${page.url()}`);

    await this.handleChallenges(page);
  }

  /**
   * Закрывает cookie-banner на странице Razer (We value your privacy).
   */
  private async dismissCookieBanner(page: Page): Promise<void> {
    try {
      const acceptBtn = page
        .getByRole('button', { name: /^accept all$/i })
        .or(page.getByRole('button', { name: /^accept$/i }))
        .or(page.locator('button').filter({ hasText: /^Accept All$/ }))
        .first();

      const visible = await acceptBtn.isVisible({ timeout: 3000 }).catch(() => false);
      if (visible) {
        await acceptBtn.click();
        this.logger.log('Cookie banner dismissed');
        await page.waitForTimeout(1000);
      }
    } catch { /* нет баннера — пропускаем */ }
  }

  /**
   * Проверяет есть ли форма логина на странице.
   */
  private async detectLoginForm(page: Page): Promise<boolean> {
    const indicators = [
      page.locator('input[type="email"], input[name*="email" i], input[id*="email" i]'),
      page.locator('input[type="password"]'),
      page.getByText(/log in to razer id/i),
      page.getByText(/sign in/i),
    ];

    for (const indicator of indicators) {
      const count = await indicator.count().catch(() => 0);
      if (count > 0) {
        const visible = await indicator.first().isVisible().catch(() => false);
        if (visible) return true;
      }
    }
    return false;
  }

  /**
   * Логинится в Razer ID на странице checkout через email/password.
   * Если включена 2FA — генерирует код через TOTP secret.
   */
  private async loginToRazer(
    page: Page,
    email: string,
    password: string,
    screenshotDir: string,
    totpSecret?: string,
  ): Promise<void> {
    this.logger.log(`Logging into Razer as ${email}...`);

    // Ищем поле email
    const emailField = page
      .locator('input[type="email"]')
      .or(page.locator('input[name*="email" i]'))
      .or(page.locator('input[id*="email" i]'))
      .or(page.locator('input[placeholder*="email" i]'))
      .first();

    await emailField.waitFor({ state: 'visible', timeout: 10_000 });
    await emailField.click();
    await emailField.fill(email);
    await page.waitForTimeout(500 + Math.random() * 500);

    // Ищем поле пароля
    const passwordField = page.locator('input[type="password"]').first();
    await passwordField.waitFor({ state: 'visible', timeout: 5_000 });
    await passwordField.click();
    await passwordField.fill(password);
    await page.waitForTimeout(500 + Math.random() * 500);

    // Обрабатываем капчу если появилась
    await this.handleChallenges(page);

    // Кнопка LOGIN — ищем рядом с полем пароля, чтобы не зацепить APPLY/PROMO кнопки
    // Стратегия: находим кнопку которая внутри той же формы что и password input
    const loginBtn = await this.findLoginButtonNearPassword(page);

    await loginBtn.waitFor({ state: 'visible', timeout: 10_000 });
    await page.waitForTimeout(500);
    await loginBtn.click();
    this.logger.log('Clicked Razer LOGIN button');

    // Ждём редиректа после логина или появления формы 2FA
    await page.waitForTimeout(5000);
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});

    // Снова обрабатываем капчу если появилась после логина
    await this.handleChallenges(page);

    // Проверяем — появилась ли форма 2FA
    const needs2FA = await this.detect2FAForm(page);
    if (needs2FA) {
      this.logger.log('2FA form detected on Razer');

      if (!totpSecret) {
        await this.takeScreenshot(page, screenshotDir, 'razer-2fa-needed').catch(() => {});
        throw this.purchaseError('requires_2fa', 'Razer requires 2FA but no TOTP secret configured');
      }

      await this.handle2FA(page, totpSecret, screenshotDir);
    }

    await this.takeScreenshot(page, screenshotDir, 'razer-after-login').catch(() => {});
    this.logger.log(`URL after Razer login: ${page.url()}`);

    // Проверяем что логин прошёл (нет больше формы)
    const stillNeedsLogin = await this.detectLoginForm(page);
    if (stillNeedsLogin) {
      this.logger.error('Razer login failed — form still visible');
      throw this.purchaseError('payment_failed', 'Razer login failed (wrong credentials or captcha not solved)');
    }

    this.logger.log('Razer login successful');
  }

  /**
   * Проверяет есть ли форма 2FA на странице (включая iframe).
   */
  private async detect2FAForm(page: Page): Promise<boolean> {
    // Проверяем основную страницу
    if (await this.check2FAOnFrame(page)) return true;

    // Проверяем все iframe на странице
    const iframes = await page.locator('iframe').all();
    for (const iframe of iframes) {
      try {
        const src = await iframe.getAttribute('src').catch(() => '');
        const frame = page.frameLocator(`iframe[src="${src}"]`);
        // Проверяем текст 2FA внутри iframe
        const twoStepText = await frame.getByText(/2-step authentication/i).count().catch(() => 0);
        if (twoStepText > 0) {
          this.logger.log('2FA form found inside iframe');
          return true;
        }
        const authText = await frame.getByText(/enter.*code.*authenticator/i).count().catch(() => 0);
        if (authText > 0) {
          this.logger.log('2FA authenticator text found inside iframe');
          return true;
        }
        // 6 полей по 1 символу внутри iframe
        const singleInputs = await frame.locator('input[maxlength="1"]').count().catch(() => 0);
        if (singleInputs >= 6) {
          this.logger.log(`Found ${singleInputs} single-digit inputs inside iframe — 2FA`);
          return true;
        }
      } catch { /* cross-origin or other error — skip */ }
    }

    // Также проверяем через page.frames() — Playwright API для доступа к фреймам
    for (const frame of page.frames()) {
      try {
        const twoStepEl = await frame.locator('text=2-STEP AUTHENTICATION').count().catch(() => 0);
        if (twoStepEl > 0) {
          this.logger.log('2FA found via page.frames()');
          return true;
        }
        const singleInputs = await frame.locator('input[maxlength="1"]').count().catch(() => 0);
        if (singleInputs >= 6) {
          this.logger.log(`Found ${singleInputs} single-digit inputs via page.frames()`);
          return true;
        }
      } catch { /* skip */ }
    }

    return false;
  }

  /**
   * Проверяет 2FA на конкретном фрейме/странице.
   */
  private async check2FAOnFrame(page: Page): Promise<boolean> {
    const twoFaTextIndicators = [
      page.getByText(/2-step authentication/i),
      page.getByText(/two[\s-]factor authentication/i),
      page.getByText(/enter.*code.*generated.*authenticator/i),
      page.getByText(/enter.*verification code/i),
      page.getByText(/2-step verification/i),
    ];

    for (const indicator of twoFaTextIndicators) {
      const count = await indicator.count().catch(() => 0);
      if (count > 0) {
        const visible = await indicator.first().isVisible().catch(() => false);
        if (visible) return true;
      }
    }

    const singleDigitInputs = await page.locator('input[maxlength="1"]').count().catch(() => 0);
    if (singleDigitInputs >= 6) return true;

    return false;
  }

  /**
   * Заполняет 2FA код используя TOTP secret.
   * Ищет поля ввода на основной странице и во всех iframe.
   */
  private async handle2FA(page: Page, totpSecret: string, screenshotDir: string): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { authenticator } = require('otplib');

    const code = authenticator.generate(totpSecret.replace(/\s/g, '').toUpperCase());
    this.logger.log(`Generated TOTP code (length: ${code.length})`);

    await this.takeScreenshot(page, screenshotDir, 'razer-2fa-form').catch(() => {});

    let filled = false;

    // Сначала пробуем на основной странице
    const singleDigitInputsMain = await page.locator('input[maxlength="1"]').all();
    if (singleDigitInputsMain.length >= 6) {
      this.logger.log('Filling 2FA on main page: 6 separate digit inputs');
      for (let i = 0; i < 6; i++) {
        await singleDigitInputsMain[i].fill(code[i]);
        await page.waitForTimeout(50 + Math.random() * 50);
      }
      filled = true;
    }

    // Если не нашли на основной — ищем во фреймах
    if (!filled) {
      for (const frame of page.frames()) {
        try {
          // Расширенный поиск
          let inputs = await frame.locator('input[maxlength="1"]').all();
          if (inputs.length < 6) inputs = await frame.locator('input[type="tel"]').all();
          if (inputs.length < 6) {
            const textInputs = await frame.locator('input[type="text"]').all();
            if (textInputs.length === 6) inputs = textInputs;
          }
          if (inputs.length < 6) {
            const numInputs = await frame.locator('input[type="number"]').all();
            if (numInputs.length === 6) inputs = numInputs;
          }

          if (inputs.length >= 6) {
            this.logger.log(`Filling 2FA in frame: ${inputs.length} digit inputs`);
            for (let i = 0; i < 6; i++) {
              await inputs[i].fill(code[i]);
              await page.waitForTimeout(100 + Math.random() * 100);
            }
            filled = true;
            break;
          }
        } catch { /* skip frame */ }
      }
    }

    // Если всё ещё не нашли — пробуем ввести через клавиатуру
    // Фокусируемся на первый видимый инпут рядом с текстом "2-step" и печатаем код
    if (!filled) {
      this.logger.log('Trying keyboard input approach for 2FA...');
      for (const frame of page.frames()) {
        try {
          // Ищем текст 2FA в этом фрейме
          const has2FA = await frame.locator('text=2-STEP AUTHENTICATION').count().catch(() => 0);
          if (has2FA === 0) continue;

          // Нашли фрейм с 2FA — кликаем по первому видимому инпуту
          const anyInput = frame.locator('input:visible').first();
          if (await anyInput.count().catch(() => 0) > 0) {
            await anyInput.click();
            // Печатаем код через клавиатуру — это работает даже с кастомными компонентами
            await page.keyboard.type(code, { delay: 100 });
            this.logger.log('Typed 2FA code via keyboard');
            filled = true;
            break;
          }
        } catch { /* skip */ }
      }
    }

    // Если всё ещё не нашли — пробуем одно поле OTP
    if (!filled) {
      const codeField = page
        .locator('input[autocomplete="one-time-code"]')
        .or(page.locator('input[name*="otp" i]'))
        .or(page.locator('input[inputmode="numeric"]'))
        .first();

      if (await codeField.isVisible({ timeout: 3000 }).catch(() => false)) {
        await codeField.fill(code);
        this.logger.log('Filled 2FA: single input field');
        filled = true;
      }
    }

    if (!filled) {
      this.logger.error('Could not find 2FA input fields anywhere');
      // Диагностика: логируем все инпуты во всех фреймах
      for (const frame of page.frames()) {
        try {
          const allInputs = await frame.locator('input').all();
          if (allInputs.length > 0) {
            this.logger.log(`Frame "${frame.url().substring(0, 60)}": ${allInputs.length} inputs`);
            for (const inp of allInputs.slice(0, 10)) {
              const type = await inp.getAttribute('type').catch(() => '?');
              const maxlen = await inp.getAttribute('maxlength').catch(() => '?');
              const name = await inp.getAttribute('name').catch(() => '?');
              const placeholder = await inp.getAttribute('placeholder').catch(() => '?');
              this.logger.log(`  input: type=${type} maxlength=${maxlen} name=${name} placeholder=${placeholder}`);
            }
          }
        } catch { /* skip */ }
      }
      throw this.purchaseError('requires_2fa', 'Could not find 2FA input fields on page');
    }

    await page.waitForTimeout(1000);

    // Submit — ищем кнопку на основной странице и во фреймах
    let submitted = false;
    for (const frame of page.frames()) {
      try {
        const submitBtn = frame.locator('button[type="submit"], button:has-text("Verify"), button:has-text("Submit"), button:has-text("Continue")').first();
        if (await submitBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await submitBtn.click();
          this.logger.log('Clicked 2FA verify button');
          submitted = true;
          break;
        }
      } catch { /* skip */ }
    }

    if (!submitted) {
      this.logger.log('No submit button found — waiting for auto-submit');
    }

    await page.waitForTimeout(5000);
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    await this.takeScreenshot(page, screenshotDir, 'razer-after-2fa').catch(() => {});

    this.logger.log('2FA handling complete');
  }

  /**
   * Обрабатывает промежуточные страницы Epic которые появляются перед checkout:
   * - Age verification
   * - Terms of Service update
   * - "Add payment method" prompt
   * - Email verification required
   * - Checkout открылся как отдельная страница (не модалка)
   */
  private async handleIntermediatePages(page: Page, screenshotDir: string): Promise<void> {
    const currentUrl = page.url();
    this.logger.log(`Checking intermediate pages. Current URL: ${currentUrl}`);

    // 1. Если Epic редиректнул на отдельную страницу checkout (не модалка)
    if (currentUrl.includes('/purchase') || currentUrl.includes('/checkout') || currentUrl.includes('payment-website-pci')) {
      this.logger.log('Detected checkout as separate page (not modal) — this is OK, continuing');
      return;
    }

    // 2. Age verification — "Confirm your age"
    const ageVerifyBtn = page
      .getByRole('button', { name: /i am 18|confirm age|yaşımı onayla|18 yaşındayım/i })
      .or(page.locator('[data-testid="age-gate-confirm"]'))
      .first();

    if (await ageVerifyBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      this.logger.log('Age verification detected — clicking confirm');
      await ageVerifyBtn.click();
      await page.waitForTimeout(2000);
      return;
    }

    // 3. Terms of Service update — "Accept Terms"
    const tosBtn = page
      .getByRole('button', { name: /accept|agree|kabul et|i agree/i })
      .first();

    const tosText = await page.getByText(/terms of service|kullanım koşulları|privacy policy/i).count().catch(() => 0);
    if (tosText > 0 && await tosBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      this.logger.log('Terms of Service update detected — accepting');
      await tosBtn.click();
      await page.waitForTimeout(2000);
      return;
    }

    // 4. "Add payment method" — Epic требует добавить карту
    const addPaymentText = await page
      .getByText(/add a payment method|ödeme yöntemi ekle|no payment method/i)
      .count()
      .catch(() => 0);
    if (addPaymentText > 0) {
      this.logger.warn('Epic requires adding payment method — cannot proceed automatically');
      await this.takeScreenshot(page, screenshotDir, 'payment-method-required').catch(() => {});
      throw this.purchaseError('payment_failed', 'Epic requires adding a payment method to the account');
    }

    // 5. Email verification required
    const emailVerifyText = await page
      .getByText(/verify your email|e-postanızı doğrulayın|confirm your email/i)
      .count()
      .catch(() => 0);
    if (emailVerifyText > 0) {
      this.logger.warn('Email verification required');
      await this.takeScreenshot(page, screenshotDir, 'email-verify-required').catch(() => {});
      throw this.purchaseError('requires_2fa', 'Epic requires email verification before purchase');
    }

    // 6. Логируем текущее состояние страницы для диагностики
    const pageTitle = await page.title().catch(() => 'unknown');
    const bodyText = await page.locator('body').textContent({ timeout: 3000 }).catch(() => '');
    const truncated = bodyText?.substring(0, 500) || '';
    this.logger.log(`Page state after Buy click — title: "${pageTitle}", body preview: "${truncated}"`);
  }

  /**
   * Обрабатывает все вызовы на странице:
   * - hCaptcha → решает через 2Captcha и вставляет токен
   * - 2FA → бросает ошибку (требует ручного вмешательства)
   * - Региональный блок → бросает ошибку
   */
  private async handleChallenges(page: Page): Promise<void> {
    // 1. hCaptcha
    const hcaptchaFrame = page.locator('iframe[src*="hcaptcha.com"]').first();
    const hasCaptcha = await hcaptchaFrame.count().then((c) => c > 0).catch(() => false);

    if (hasCaptcha) {
      if (!this.captchaSolver) {
        throw this.purchaseError('requires_captcha', 'hCaptcha detected but CaptchaSolverService not injected');
      }

      this.logger.log('hCaptcha detected — solving via 2Captcha...');

      const userAgent = await page.evaluate(() => navigator.userAgent).catch(() => undefined);
      const token = await this.captchaSolver.solveHCaptcha(
        CaptchaSolverService.EPIC_HCAPTCHA_SITEKEY,
        page.url(),
        userAgent,
      );

      // Вставляем токен в скрытые поля формы
      await page.evaluate((captchaToken) => {
        // Стандартное поле hCaptcha
        const responseField = document.querySelector('[name="h-captcha-response"]') as HTMLTextAreaElement;
        if (responseField) responseField.value = captchaToken;

        // Дополнительное поле для некоторых реализаций
        const gResponseField = document.querySelector('[name="g-recaptcha-response"]') as HTMLTextAreaElement;
        if (gResponseField) gResponseField.value = captchaToken;

        // Триггерим callback если он есть
        const hcaptchaWidget = (window as any).hcaptcha;
        if (hcaptchaWidget && typeof hcaptchaWidget.execute === 'function') {
          try { hcaptchaWidget.execute(); } catch { /* ignore */ }
        }
      }, token);

      await page.waitForTimeout(1000);

      // Ищем кнопку подтверждения капчи и кликаем
      const submitBtn = page
        .getByRole('button', { name: /verify|submit|confirm|continue/i })
        .or(page.locator('[data-testid="captcha-submit"]'))
        .first();

      if (await submitBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await submitBtn.click();
        await page.waitForTimeout(2000);
      }

      this.logger.log('hCaptcha token injected successfully');
    }

    // 2. 2FA
    const twoFaSelectors = ['input[name="otpCode"]', 'input[placeholder*="6-digit" i]'];
    for (const sel of twoFaSelectors) {
      if (await page.locator(sel).count().then((c) => c > 0).catch(() => false)) {
        throw this.purchaseError('requires_2fa', '2FA verification required');
      }
    }

    // 3. Региональный блок
    const regionBlocked = await page
      .getByText(/not available in your region|geo-?blocked|country.*not supported/i)
      .count()
      .catch(() => 0);
    if (regionBlocked > 0) {
      throw this.purchaseError('region_restricted', 'Region-restricted page');
    }
  }

  private purchaseError(reason: PurchaseErrorReason, message: string): Error & { purchaseReason: PurchaseErrorReason } {
    const error = new Error(message) as Error & { purchaseReason: PurchaseErrorReason };
    error.purchaseReason = reason;
    return error;
  }

  private failure(reason: PurchaseErrorReason, message: string): PurchaseResult {
    return { success: false, errorReason: reason, errorMessage: message };
  }

  private async takeScreenshot(page: Page, dir: string, label: string): Promise<string> {
    // Скриншоты отключены для ускорения заказов
    return '';
  }
}
