# 🎮 Bag1V-Bucks — Статус разработки

> Последнее обновление: 11 мая 2026

---

## 📖 О проекте

Автоматизированный сервис продажи V-Bucks (Fortnite). Продавец генерирует ссылку → покупатель авторизуется через Epic Games → бот Playwright автоматически покупает V-Bucks через турецкий Razer Gold и доставляет на аккаунт.

**Стек:** NestJS (backend) + Next.js 14 (frontend) + PostgreSQL + Redis/BullMQ + Playwright

---

## ✅ Что сделано

### Backend (NestJS) — `backend/src/`

#### Модуль заказов (`orders/`)
- [x] `Order` entity — полная модель (30+ полей: статусы, Epic токены, Razer данные, timeline)
- [x] `TimelineLogEntry` entity — журнал этапов обработки
- [x] `Balance` entity — учёт баланса
- [x] `OrdersService` — CRUD, статусы, timeline-логи, статистика (`getStats()`)
- [x] `OrdersController` — REST API + SSE streaming + пагинация/фильтрация
- [x] `CreateOrderDto` — валидация входных данных
- [x] SSE endpoint `GET /api/orders/:orderId/stream` — real-time обновления статуса

#### Авторизация Epic Games (`auth/`)
- [x] `AuthService` — Device Auth Flow (initiate → poll → getAccount → refreshToken)
- [x] `AuthController` — POST /initiate, /poll, /verify

#### Автоматизация браузера (`epic/`)
- [x] `EpicBrowserService` (516 строк) — Playwright Stealth:
  - Логин в Epic Games
  - Смена региона на Турцию
  - Покупка V-Bucks (выбор пакета → Razer Gold → подтверждение)
  - Скриншоты ошибок, anti-detection
- [x] `RazerGoldService` — OAuth авторизация с auto-refresh, баланс, создание платежей

#### Очередь обработки (`queue/`)
- [x] `OrderProcessor` — BullMQ worker (3 попытки, exponential backoff)
- [x] `OrderProcessingService` — полный pipeline:
  - Проверка статуса → инициализация браузера → проверка баланса → покупка → webhook → Telegram
- [x] `QueueService` — управление очередью (add/status/remove)

#### Платежи (`payments/`)
- [x] `PaymentsService` — AntiLav API: создание инвойсов, проверка, отмена
- [x] HMAC-SHA256 верификация webhook подписи (timing-safe)
- [x] `PaymentsController` — CRUD + webhook endpoint с проверкой подписи
- [x] Mock-режим для разработки

#### Админка (`admin/`)
- [x] `AdminAuthService` — JWT с iat/exp, scrypt+salt хеширование паролей
- [x] Автоматическая миграция legacy SHA-256 → scrypt при логине
- [x] Brute-force защита (5 попыток → блокировка 15 мин)
- [x] `AdminAuthGuard` — Bearer token валидация
- [x] `AdminAuthController` — login, register, me, verify (с AuthRateLimitGuard)
- [x] `SeedService` — создание дефолтного админа через AdminAuthService

#### Вебхуки (`webhooks/`)
- [x] `WebhooksService` — отправка webhook уведомлений продавцу
- [x] `WebhooksController` — тест и триггер

#### Общие модули (`common/`)
- [x] `OrderExpirationService` — Cron каждые 5 мин: отмена просроченных заказов
- [x] `NotificationService` — Telegram уведомления (новый заказ, выполнен, ошибка, оплата, системные)
- [x] `RateLimitGuard` — in-memory rate limiting (AuthRateLimitGuard: 5/min, ApiRateLimitGuard: 60/min)
- [x] `LoggingInterceptor` — HTTP логирование (метод, URL, статус, время, IP)

#### Инфраструктура
- [x] `docker-compose.yml` — PostgreSQL + Redis + Backend + Frontend + Nginx
- [x] `backend/Dockerfile` — multi-stage build с Chromium
- [x] `frontend/Dockerfile` — multi-stage build со standalone output
- [x] `nginx/default.conf` — reverse proxy + security headers + SSE support
- [x] `.env` — все конфиги (DB, Redis, Epic, Razer, AntiLav, JWT, Webhook, Telegram)

---

### Frontend (Next.js 14) — `frontend/src/`

#### Страницы
- [x] **Лендинг** (`app/page.tsx`, 932 строки) — Hero, 6 пакетов V-Bucks, "Как это работает", преимущества, отзывы, FAQ, CTA, scroll-анимации
- [x] **Buyer page** (`app/buyer/page.tsx`) — подключена к реальному API через slug, таймер, статусы (ожидание/обработка/выполнен/истёк)
- [x] **Order page** (`app/order/[orderId]/page.tsx`) — детали заказа с API
- [x] **Order auth** (`app/order/[orderId]/auth/page.tsx`) — авторизация Epic Games
- [x] **Order timeline** (`app/order/[orderId]/timeline/page.tsx`) — шкала обработки
- [x] **Admin dashboard** (`app/admin/page.tsx`, 685 строк) — статистика, прайс-лист, генератор ссылок, таблица заказов
- [x] **Admin login** (`app/admin/login/page.tsx`) — использует centralized adminAuthApi

#### Компоненты и утилиты
- [x] `components/ui/` — Button, Card, Logo, ErrorBoundary
- [x] `components/buyer/HeroLogo` — анимированный логотип
- [x] `lib/api.ts` — axios клиент с Bearer token interceptor + auto-redirect на 401
- [x] `app/providers.tsx` — QueryClient + ErrorBoundary wrapper
- [x] `middleware.ts` — защита маршрутов админки

---

## ❌ Что осталось сделать

### 🔴 Критично (без этого не запустится в продакшене)

#### 1. Настроить реальные API ключи
**Файл:** `backend/.env`
**Что нужно:**
- `EPIC_CLIENT_ID` / `EPIC_CLIENT_SECRET` — зарегистрировать приложение на [dev.epicgames.com](https://dev.epicgames.com)
- `RAZER_USERNAME` / `RAZER_PASSWORD` — получить аккаунт продавца на [gold.razer.com](https://gold.razer.com)
- `ANTILAV_API_KEY` / `ANTILAV_SHOP_ID` — зарегистрировать магазин в AntiLav
- `JWT_SECRET` — сгенерировать случайный ключ (минимум 32 символа)
- `WEBHOOK_SECRET` — сгенерировать HMAC секрет
- `ADMIN_DEFAULT_PASSWORD` — поменять с `admin123`

**Как сделать:**
```bash
# Генерация секретов:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

#### 2. Протестировать Playwright бот на реальном аккаунте
**Файл:** `backend/src/epic/epic-browser.service.ts`
**Что нужно:**
- Проверить логин через exchange code на реальном Epic аккаунте
- Проверить смену региона на Турцию
- Проверить покупку V-Bucks с реальным Razer Gold
- Добавить обработку новых ошибок если появятся капчи или 2FA

**План:**
1. Создать тестовый Epic аккаунт
2. Запустить бот в headless=false режиме (`BROWSER_HEADLESS=false`)
3. Пошагово проверить каждый этап покупки
4. Записать скриншоты каждого шага для документации

---

### 🟡 Важно (влияет на качество)

#### 3. Подключить SSE клиент на фронтенде
**Где:** `frontend/src/app/order/[orderId]/page.tsx`
**Что нужно:** Использовать `EventSource` для подключения к `GET /api/orders/:orderId/stream`

**План реализации:**
```typescript
// Добавить в useEffect order page:
useEffect(() => {
  if (!orderId || order?.status === 'completed' || order?.status === 'failed') return;
  
  const eventSource = new EventSource(
    `${process.env.NEXT_PUBLIC_API_URL}/orders/${orderId}/stream`
  );
  
  eventSource.onmessage = (event) => {
    const data = JSON.parse(event.data);
    setOrder(prev => ({ ...prev, ...data }));
  };
  
  return () => eventSource.close();
}, [orderId, order?.status]);
```

#### 4. Responsive дизайн админки
**Где:** `frontend/src/app/admin/page.tsx`
**Что нужно:**
- Гамбургер-меню на мобилках
- Таблица заказов → карточки на мобилках
- Stat-карточки в одну колонку
- Drawer деталей — fullscreen на мобилках

#### 5. Unit/E2E тесты
**Что нужно:**
- Backend: jest тесты для OrdersService, AdminAuthService, PaymentsService
- Frontend: playwright e2e тесты для buyer flow и admin login
- Mocking для Epic Games API и Razer Gold

**План:**
1. `npm i -D jest @nestjs/testing` (backend)
2. `npm i -D @playwright/test` (frontend)
3. Написать тесты для каждого сервиса
4. Настроить CI для запуска тестов

#### 6. HTTPS / SSL
**Что нужно:** Certbot + Let's Encrypt

**План:**
1. Купить домен
2. Добавить certbot контейнер в docker-compose
3. Обновить nginx конфиг для SSL
4. Настроить auto-renew

---

### 🟢 Улучшения (polish)

#### 7. CI/CD pipeline
**Где:** `.github/workflows/deploy.yml`
**Что нужно:**
- GitHub Actions: lint → test → build → deploy
- Автодеплой на VPS через SSH

#### 8. Мониторинг
**Что нужно:**
- Health check endpoint `GET /api/health`
- Uptime monitoring (UptimeRobot / Better Stack)
- Error tracking (Sentry)

#### 9. Бэкапы БД
**Что нужно:**
- Cron для pg_dump
- Хранение на S3 / внешнем хранилище
- Ротация (7 дней)

---

## 📊 Готовность проекта

```
Backend модули:    █████████████████████░  ~90%
Frontend UI:       ████████████████████░░  ~85%
Безопасность:      █████████████████░░░░░  ~70%
Интеграции:        ██████████░░░░░░░░░░░░  ~40%  ← нужны API ключи
Production-ready:  ██████████████░░░░░░░░  ~55%  ← нужны HTTPS, CI/CD
```

**Общая оценка: ~75%**

---

## 🚀 Порядок запуска для разработки

```bash
# 1. Запустить БД и Redis
docker compose up postgres redis -d

# 2. Запустить backend
cd backend
npm install
npm run start:dev

# 3. Запустить frontend
cd frontend
npm install
npm run dev
```

## 🚀 Порядок деплоя в продакшен

```bash
# 1. Настроить .env с реальными ключами
# 2. Запустить всё через Docker
docker compose --profile production up -d --build

# 3. Проверить
curl http://localhost/api/orders/stats
```
