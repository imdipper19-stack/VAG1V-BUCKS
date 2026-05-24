# Design Document: Partner Program

## Overview

Партнёрская программа добавляет в Bag1V-Bucks систему реферального трафика через промокоды. Архитектура строится поверх существующего стека: NestJS backend, TypeORM + PostgreSQL, Next.js frontend. Новый `PartnerModule` изолирован от остальных модулей и интегрируется с `OrdersModule` и `QueueModule` через минимальные точки связи.

---

## 1. Database Schema

### 1.1 Новые таблицы

#### `partners`
```sql
id                  UUID PRIMARY KEY DEFAULT gen_random_uuid()
username            VARCHAR(64) UNIQUE NOT NULL        -- логин для входа в кабинет
password_hash       VARCHAR(255) NOT NULL               -- bcrypt/scrypt hash
display_name        VARCHAR(128) NOT NULL               -- имя/ник партнёра
contact_tg          VARCHAR(64) NOT NULL                -- @username в Telegram
commission_rate     DECIMAL(5,4) NOT NULL DEFAULT 0.10  -- 0.0000–1.0000
discount_rate       DECIMAL(5,4) NOT NULL DEFAULT 0.05  -- 0.0000–1.0000
status              ENUM('active','disabled') NOT NULL DEFAULT 'active'
invite_token        VARCHAR(128) UNIQUE                 -- одноразовый токен для установки пароля
invite_token_used   BOOLEAN NOT NULL DEFAULT FALSE
invite_token_expires_at TIMESTAMP
application_id      UUID REFERENCES partner_applications(id) ON DELETE SET NULL
created_at          TIMESTAMP NOT NULL DEFAULT NOW()
updated_at          TIMESTAMP NOT NULL DEFAULT NOW()
```

#### `partner_promo_codes`
```sql
id          UUID PRIMARY KEY DEFAULT gen_random_uuid()
partner_id  UUID NOT NULL REFERENCES partners(id) ON DELETE CASCADE
code        VARCHAR(16) UNIQUE NOT NULL   -- [A-Z0-9], 6–16 символов
is_current  BOOLEAN NOT NULL DEFAULT TRUE -- только один активный код на партнёра
created_at  TIMESTAMP NOT NULL DEFAULT NOW()
```
> Индекс: `UNIQUE INDEX ON partner_promo_codes(code)` — быстрый lookup при чекауте.

#### `partner_applications`
```sql
id              UUID PRIMARY KEY DEFAULT gen_random_uuid()
display_name    VARCHAR(128) NOT NULL
platform_type   ENUM('telegram','vk','twitch','youtube','tiktok','other') NOT NULL
platform_url    VARCHAR(512) NOT NULL
audience_size   VARCHAR(64) NOT NULL
contact_tg      VARCHAR(64) NOT NULL
description     TEXT NOT NULL
status          ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending'
reviewed_by     UUID REFERENCES admins(id) ON DELETE SET NULL
reviewed_at     TIMESTAMP
partner_id      UUID REFERENCES partners(id) ON DELETE SET NULL  -- заполняется при одобрении
created_at      TIMESTAMP NOT NULL DEFAULT NOW()
updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
```

#### `commission_entries`
```sql
id              UUID PRIMARY KEY DEFAULT gen_random_uuid()
order_id        UUID NOT NULL UNIQUE REFERENCES orders(id) ON DELETE RESTRICT
partner_id      UUID NOT NULL REFERENCES partners(id) ON DELETE RESTRICT
amount          DECIMAL(12,2) NOT NULL   -- сумма комиссии в рублях
status          ENUM('pending','approved','cancelled') NOT NULL DEFAULT 'pending'
approved_at     TIMESTAMP
cancelled_at    TIMESTAMP
created_at      TIMESTAMP NOT NULL DEFAULT NOW()
updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
```
> `UNIQUE` на `order_id` гарантирует не более одной записи на заказ (Requirement 10.5).

#### `payout_requests`
```sql
id              UUID PRIMARY KEY DEFAULT gen_random_uuid()
partner_id      UUID NOT NULL REFERENCES partners(id) ON DELETE RESTRICT
amount          DECIMAL(12,2) NOT NULL
requisites      TEXT NOT NULL            -- реквизиты для перевода (свободный текст)
status          ENUM('requested','processing','paid','rejected') NOT NULL DEFAULT 'requested'
rejection_reason TEXT
processed_by    UUID REFERENCES admins(id) ON DELETE SET NULL
requested_at    TIMESTAMP NOT NULL DEFAULT NOW()
processing_at   TIMESTAMP
paid_at         TIMESTAMP
rejected_at     TIMESTAMP
created_at      TIMESTAMP NOT NULL DEFAULT NOW()
updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
```

#### `partner_audit_log`
```sql
id          UUID PRIMARY KEY DEFAULT gen_random_uuid()
entity_type VARCHAR(64) NOT NULL   -- 'partner' | 'application' | 'payout_request' | 'commission_entry'
entity_id   UUID NOT NULL
action      VARCHAR(128) NOT NULL  -- 'status_changed' | 'rate_updated' | 'code_regenerated' | ...
actor_type  ENUM('admin','system') NOT NULL
actor_id    UUID                   -- admin.id или NULL для system
old_value   JSONB
new_value   JSONB
created_at  TIMESTAMP NOT NULL DEFAULT NOW()
```

### 1.2 Изменения в существующей таблице `orders`

Добавляем 4 nullable-колонки (миграция без breaking changes):

```sql
ALTER TABLE orders ADD COLUMN partner_id             UUID REFERENCES partners(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN promo_code_snapshot    VARCHAR(16);   -- код на момент создания
ALTER TABLE orders ADD COLUMN discount_rate_snapshot DECIMAL(5,4);  -- snapshot Discount_Rate
ALTER TABLE orders ADD COLUMN commission_rate_snapshot DECIMAL(5,4); -- snapshot Commission_Rate
ALTER TABLE orders ADD COLUMN discount_amount        DECIMAL(12,2); -- фактическая сумма скидки
```

---

## 2. Backend Architecture (NestJS)

### 2.1 Новый модуль `PartnerModule`

```
backend/src/partner/
├── partner.module.ts
├── entities/
│   ├── partner.entity.ts
│   ├── partner-promo-code.entity.ts
│   ├── partner-application.entity.ts
│   ├── commission-entry.entity.ts
│   ├── payout-request.entity.ts
│   └── partner-audit-log.entity.ts
├── dto/
│   ├── create-application.dto.ts
│   ├── approve-application.dto.ts
│   ├── create-partner.dto.ts
│   ├── update-partner.dto.ts
│   ├── validate-promo-code.dto.ts
│   ├── create-payout-request.dto.ts
│   └── update-payout-status.dto.ts
├── guards/
│   └── partner-auth.guard.ts
├── decorators/
│   └── current-partner.decorator.ts
├── partner-application.service.ts
├── partner.service.ts
├── partner-auth.service.ts
├── commission.service.ts
├── payout.service.ts
├── promo-code.service.ts
├── partner-public.controller.ts    -- /api/partner/applications, /api/partner/auth/*
├── partner-cabinet.controller.ts   -- /api/partner/dashboard, /api/partner/payouts
└── partner-admin.controller.ts     -- /api/admin/partners/*, /api/admin/payouts/*
```

### 2.2 Сервисы и их ответственность

**`PartnerAuthService`**
- `generateInviteToken(partnerId)` — создаёт одноразовый токен (crypto.randomBytes(32)), сохраняет хеш в `partners.invite_token`, TTL 72 часа
- `setPasswordViaInvite(token, password)` — валидирует токен, хеширует пароль через `bcrypt` (rounds=12), помечает токен использованным
- `login(username, password)` — проверяет пароль, статус `active`, возвращает JWT
- `generateJwt(partner)` — подписывает `{ sub, username, role:'partner' }`, TTL 24h, тот же `JWT_SECRET` что у AdminAuthService
- `verifyJwt(token)` — декодирует и проверяет подпись + exp

> Решение по паролю: **invite-link**. При одобрении заявки или ручном создании партнёра система генерирует одноразовую ссылку `/partner/invite?token=XXX`. Владелец копирует её и отправляет партнёру в TG. Партнёр переходит по ссылке, задаёт пароль сам. Это безопаснее временного пароля (не передаётся открытым текстом) и не требует SMTP.

**`PromoCodeService`**
- `generate(partnerId)` — генерирует код `[A-Z0-9]` длиной 8 символов, проверяет уникальность в БД, до 10 попыток, затем ошибка
- `validate(code)` — возвращает `{ partner, discountRate }` или бросает исключение
- `regenerate(partnerId)` — помечает старый код `is_current=false`, создаёт новый

**`CommissionService`**
- `createPending(orderId, partnerId, amount)` — INSERT с `ON CONFLICT (order_id) DO NOTHING` для идемпотентности
- `approve(orderId)` — UPDATE status='approved' WHERE order_id=? AND status='pending'
- `cancel(orderId)` — UPDATE status='cancelled' WHERE order_id=? AND status='pending'
- Оба метода идемпотентны: повторный вызов с тем же orderId не меняет уже финальный статус

**`PayoutService`**
- `create(partnerId, amount, requisites)` — проверяет `amount <= partnerBalance`, создаёт запись
- `getBalance(partnerId)` — вычисляет `SUM(approved commissions) - SUM(paid/requested/processing payouts)`
- `updateStatus(payoutId, newStatus, adminId)` — state machine: `requested→processing→paid`, `requested/processing→rejected`; при `rejected` баланс автоматически восстанавливается (нет отдельного резервирования — баланс вычисляется динамически)

**`PartnerService`**
- CRUD партнёров для Admin
- `updateRates(partnerId, discountRate, commissionRate)` — валидация `[0,1]` и `sum <= 1`
- `toggleStatus(partnerId)` — active ↔ disabled

### 2.3 Интеграция с `OrderProcessingService`

В `order-processing.service.ts` добавляем два хука:

```typescript
// При создании заказа (в OrdersService.createOrder или orders.controller.ts)
if (order.partnerId) {
  const commissionAmount = order.priceRUB * order.commissionRateSnapshot;
  await this.commissionService.createPending(order.id, order.partnerId, commissionAmount);
}

// В handleSuccess() после updateStatus(COMPLETED)
if (order.partnerId) {
  await this.commissionService.approve(order.id);
}

// В handleFailure() и markFailed() после updateStatus(FAILED/REFUNDED)
if (order.partnerId) {
  await this.commissionService.cancel(order.id);
}
```

`CommissionService` инжектируется в `OrderProcessingService` через `PartnerModule` (экспортирует `CommissionService`).

### 2.4 API Endpoints

#### Публичные (без авторизации)
| Method | Path | Описание |
|--------|------|----------|
| POST | `/api/partner/applications` | Подача заявки |
| POST | `/api/partner/auth/login` | Вход партнёра |
| POST | `/api/partner/auth/set-password` | Установка пароля по invite-токену |
| GET | `/api/partner/auth/invite-info` | Проверка валидности токена (для UI) |
| POST | `/api/orders/validate-promo` | Валидация промокода при чекауте |

#### Партнёрский кабинет (JWT партнёра)
| Method | Path | Описание |
|--------|------|----------|
| GET | `/api/partner/dashboard` | Баланс, статистика, промокод |
| GET | `/api/partner/orders` | История заказов |
| GET | `/api/partner/payouts` | История выплат |
| POST | `/api/partner/payouts` | Запрос выплаты |

#### Админ (JWT админа)
| Method | Path | Описание |
|--------|------|----------|
| GET | `/api/admin/partner-applications` | Список заявок |
| GET | `/api/admin/partner-applications/:id` | Детали заявки |
| POST | `/api/admin/partner-applications/:id/approve` | Одобрить заявку |
| POST | `/api/admin/partner-applications/:id/reject` | Отклонить заявку |
| GET | `/api/admin/partners` | Список партнёров |
| POST | `/api/admin/partners` | Создать партнёра вручную |
| GET | `/api/admin/partners/:id` | Детали партнёра |
| PATCH | `/api/admin/partners/:id` | Обновить rates/status |
| POST | `/api/admin/partners/:id/regenerate-code` | Регенерировать промокод |
| GET | `/api/admin/partners/:id/invite-link` | Получить invite-ссылку |
| GET | `/api/admin/payouts` | Список заявок на выплату |
| PATCH | `/api/admin/payouts/:id/status` | Изменить статус выплаты |

---

## 3. Frontend Pages (Next.js App Router)

### 3.1 Новые маршруты

```
frontend/src/app/
├── partner/
│   ├── page.tsx                  -- /partner (лендинг + форма заявки)
│   ├── login/
│   │   └── page.tsx              -- /partner/login
│   ├── invite/
│   │   └── page.tsx              -- /partner/invite?token=XXX (установка пароля)
│   └── cabinet/
│       ├── layout.tsx            -- защищённый layout (проверяет partner JWT)
│       ├── page.tsx              -- /partner/cabinet (дашборд)
│       ├── orders/
│       │   └── page.tsx          -- /partner/cabinet/orders
│       └── payouts/
│           └── page.tsx          -- /partner/cabinet/payouts
├── admin/
│   └── (существующие страницы +)
│       ├── partners/
│       │   ├── page.tsx          -- /admin/partners (список)
│       │   └── [id]/
│       │       └── page.tsx      -- /admin/partners/:id (детали)
│       ├── applications/
│       │   └── page.tsx          -- /admin/applications (заявки)
│       └── payouts/
│           └── page.tsx          -- /admin/payouts (выплаты)
```

### 3.2 Изменения в `layout.tsx` и `page.tsx`

В `layout.tsx` шапка и футер не существуют как отдельные компоненты — они встроены в `page.tsx` (`landing-nav` и `landing-footer`). Нужно:

1. Вынести `<nav>` в `frontend/src/components/layout/Header.tsx`
2. Вынести `<footer>` в `frontend/src/components/layout/Footer.tsx`
3. Добавить в `Header` и `Footer`:
   - Ссылку на TG-канал `https://t.me/FortnitebucksShop` с иконкой и `rel="noopener noreferrer"`
   - Кнопку «Стать партнёром» → `/partner`
4. Подключить компоненты в `layout.tsx` (глобально для всех страниц)

### 3.3 Поле промокода в чекауте

В `frontend/src/app/payment/page.tsx` (или компонент формы заказа) добавить:
- Input + кнопка «Применить»
- Вызов `POST /api/orders/validate-promo`
- Отображение скидки или ошибки
- При создании заказа передавать `promoCode` в тело запроса

---

## 4. Authentication Strategy

### Партнёрский JWT

Используем тот же механизм что в `AdminAuthService` (HS256, `JWT_SECRET`), но с разным `role`:
- Admin token: `{ sub, username, role: 'admin'|'super_admin'|'operator' }`
- Partner token: `{ sub, username, role: 'partner' }`

`PartnerAuthGuard` проверяет `role === 'partner'`. Это исключает использование admin-токена в partner-эндпоинтах и наоборот.

Cookie: `partner_token` (httpOnly, sameSite=strict, secure в prod). Аналогично тому как хранится admin-токен.

---

## 5. Property-Based Testing Strategy

### 5.1 Correctness Properties

**P1 — Баланс-инвариант**
```
∀ partner: balance(p) = Σ approved_commissions(p) - Σ paid_payouts(p) - Σ outstanding_payouts(p)
```
PBT: генерируем случайные последовательности заказов (completed/failed) и выплат (requested/paid/rejected), проверяем что `getBalance()` всегда равен ручному подсчёту.

**P2 — Неотрицательность баланса**
```
∀ partner: balance(p) >= 0
```
PBT: пытаемся создать `PayoutRequest` с `amount > balance`, проверяем что система всегда отказывает.

**P3 — Идемпотентность комиссии**
```
∀ orderId: approve(orderId); approve(orderId) ≡ approve(orderId)
```
PBT: вызываем `approve`/`cancel` дважды с одним orderId, проверяем что `total_earned` не изменился.

**P4 — Идемпотентность выплаты**
```
∀ payoutId: markPaid(payoutId); markPaid(payoutId) ≡ markPaid(payoutId)
```
PBT: повторный вызов `markPaid` не меняет `paid_at` и не уменьшает баланс дважды.

**P5 — Уникальность промокода**
```
∀ code: |{ partner | partner.promo_code = code }| = 1
```
PBT: параллельно генерируем N промокодов, проверяем отсутствие дубликатов в БД.

**P6 — Snapshot-корректность**
```
∀ order with partner: commission_entry.amount = order.price_rub * order.commission_rate_snapshot
```
PBT: создаём заказы с разными commission_rate, проверяем что сумма комиссии всегда соответствует snapshot.

### 5.2 Тестовый фреймворк

- Backend PBT: `fast-check` (TypeScript) + Jest
- Тесты размещаются в `backend/src/partner/__tests__/`
- Для P1–P4 используем in-memory SQLite через TypeORM (тест-конфиг)
- Для P5 используем транзакционные тесты с реальным PostgreSQL (test DB)

---

## 6. Migration Plan

Миграции TypeORM в `backend/src/database/migrations/`:

1. `YYYYMMDD_AddPartnerTables` — создаёт все 5 новых таблиц
2. `YYYYMMDD_AddPartnerFieldsToOrders` — добавляет 5 nullable-колонок в `orders`

Обе миграции обратимы (`down()` удаляет добавленное). Существующие данные не затрагиваются.
