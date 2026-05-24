# Design Document: Order Reviews

## Overview

Отдельный модуль `ReviewsModule` поверх существующего стека (NestJS + TypeORM + PostgreSQL + Next.js). Покупатель оставляет один отзыв на завершённый заказ, отзыв уходит в pending, владелец одобряет в админке, одобренные отображаются на лендинге в авторотируемой карусели. Никаких новых зависимостей — используем существующие `class-validator`, `pg`, `bullmq` (опционально для cleanup), AdminAuthGuard.

---

## 1. Database Schema

### 1.1 Новая таблица `order_reviews`

```sql
id              UUID PRIMARY KEY DEFAULT gen_random_uuid()
order_id        UUID NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE
nickname        VARCHAR(64) NOT NULL          -- trimmed plain text
stars           SMALLINT NOT NULL CHECK (stars BETWEEN 0 AND 5)
text            TEXT NOT NULL                  -- trimmed, max 1000 chars (validated app-side)
status          ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending'
rejection_reason TEXT
moderated_by    UUID REFERENCES admins(id) ON DELETE SET NULL
approved_at     TIMESTAMP
rejected_at     TIMESTAMP
ip_address      INET                            -- для rate-limit аудита
user_agent      TEXT                            -- truncated to 512 chars on insert
created_at      TIMESTAMP NOT NULL DEFAULT NOW()
updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
```

**Индексы:**
- `UNIQUE(order_id)` — одна запись на заказ (Requirement 6.2)
- `INDEX(status)` — для админской выборки pending и публичной выборки approved
- `INDEX(status, created_at DESC)` — композитный для сортированной публичной выборки
- `INDEX(ip_address, created_at)` — для rate-limit подсчёта

**Решение по `order_id ON DELETE CASCADE`:** в существующей схеме заказы не удаляются (только статусы меняются), но если когда-нибудь будет cleanup старых заказов, отзывы должны уйти вместе. Для рассмотрения админом старого отзыва есть `moderated_by` + audit log.

### 1.2 Таблица `review_rate_limit_config` (опционально, для админ-настройки)

Per-IP rate-limit можно начать с захардкоденных значений (5 / 60min) и добавить таблицу позже. **Решение для v1:** хранить значения в `settings` (существующая таблица) под ключами `reviews.rate_limit.threshold` и `reviews.rate_limit.window_seconds`. Defaults: 5 и 3600.

Это удовлетворяет Requirement 8.5 без новой таблицы.

---

## 2. Backend Architecture (NestJS)

### 2.1 Новый модуль `ReviewsModule`

```
backend/src/reviews/
├── reviews.module.ts
├── entities/
│   └── order-review.entity.ts
├── dto/
│   ├── create-review.dto.ts
│   ├── reject-review.dto.ts
│   └── public-review.dto.ts        — shape для публичного API
├── reviews.service.ts
├── reviews-public.controller.ts    — POST /api/reviews, GET /api/reviews/public
├── reviews-admin.controller.ts     — GET/PATCH /api/admin/reviews
└── reviews-eligibility.service.ts  — проверка completed + Delivery_Window + no review
```

### 2.2 `OrderReview` entity

```typescript
@Entity('order_reviews')
export class OrderReview {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ name: 'order_id', type: 'uuid', unique: true })
  orderId: string;

  @Column({ type: 'varchar', length: 64 })
  nickname: string;

  @Column({ type: 'smallint' })
  stars: number;

  @Column({ type: 'text' })
  text: string;

  @Column({
    type: 'enum',
    enum: ReviewStatus,
    enumName: 'order_reviews_status_enum',
    default: ReviewStatus.PENDING,
  })
  @Index()
  status: ReviewStatus;

  @Column({ name: 'rejection_reason', type: 'text', nullable: true })
  rejectionReason: string | null;

  @Column({ name: 'moderated_by', type: 'uuid', nullable: true })
  moderatedBy: string | null;

  @Column({ name: 'approved_at', type: 'timestamp', nullable: true })
  approvedAt: Date | null;

  @Column({ name: 'rejected_at', type: 'timestamp', nullable: true })
  rejectedAt: Date | null;

  @Column({ name: 'ip_address', type: 'inet', nullable: true })
  ipAddress: string | null;

  @Column({ name: 'user_agent', type: 'text', nullable: true })
  userAgent: string | null;

  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}

export enum ReviewStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}
```

### 2.3 `ReviewsEligibilityService`

Изолирует все проверки, чтобы их легко тестировать:

```typescript
@Injectable()
export class ReviewsEligibilityService {
  // Constants per Requirement 8.3
  private readonly DELIVERY_WINDOW_MS = 30 * 24 * 3600 * 1000;

  /**
   * Public — order page CTA visibility (Requirement 3.1–3.4).
   * Returns descriptor that the frontend renders directly.
   */
  async checkOrderEligibility(orderId: string): Promise<{
    canSubmit: boolean;
    reason?: 'not_completed' | 'window_expired' | 'already_reviewed';
    alreadyReviewed: boolean;
  }>;

  /**
   * Server-side guard at submission (Requirement 3.5–3.7).
   * Throws BadRequestException with the right localized message.
   */
  async assertCanSubmit(orderId: string): Promise<void>;
}
```

Реализация: грузит `Order` (status, completedAt), считает `now - completedAt`, делает `count(order_reviews WHERE order_id = ?)`. Никаких внешних зависимостей.

### 2.4 `ReviewsService`

```typescript
@Injectable()
export class ReviewsService {
  // Buyer-facing
  async submit(orderId: string, dto: CreateReviewDto, ip: string, ua?: string): Promise<OrderReview>;
  // Public
  async listApproved(limit?: number): Promise<PublicReviewDto[]>;
  // Admin
  async listForModeration(filters: { status?: ReviewStatus }): Promise<OrderReview[]>;
  async approve(id: string, adminId: string): Promise<OrderReview>;
  async reject(id: string, adminId: string, reason?: string): Promise<OrderReview>;
}
```

**`submit()` flow:**
1. `eligibilityService.assertCanSubmit(orderId)` — completed + window + no review.
2. Rate-limit check: `count(order_reviews WHERE ip_address = ? AND created_at > now - interval)`. Если >= threshold → `HttpException(429, 'Слишком много заявок')`.
3. Trim nickname/text (server-side per Requirement 5.1, 5.7).
4. Insert. Race on UNIQUE(order_id) → `ConflictException('Отзыв уже существует')` (Requirement 6.3).
5. Возвращает entity, статус `pending`.

**`listApproved()`:**
- `orderReviewRepo.find({ where: { status: APPROVED }, order: { createdAt: 'DESC' }, take: limit ?? 50 })`
- Маппит в `PublicReviewDto`: только `id`, `nickname`, `stars`, `text`, `createdAt` (Requirement 7.1–7.3).

**`approve(id, adminId)`:**
- Inside `dataSource.transaction`:
  - Load review. Throw `NotFoundException` if missing.
  - Throw `ConflictException` if `status !== pending` (Requirement 10.10).
  - `UPDATE order_reviews SET status='approved', approved_at=NOW(), moderated_by=:adminId WHERE id=:id`.
  - Append to `AdminActivityLog`: action `review.approve`, target id=review.id (Requirement 10.3).
- Returns updated entity.

**`reject(id, adminId, reason?)`:**
- Same pattern: status check → set `status='rejected'`, `rejected_at`, `rejection_reason`, `moderated_by` → audit log `review.reject` with reason in metadata (Requirement 10.7).

### 2.5 `ReviewsPublicController`

```typescript
@Controller()
export class ReviewsPublicController {
  // POST /api/orders/:orderId/reviews
  @Post('orders/:orderId/reviews')
  @HttpCode(201)
  async submit(@Param('orderId') orderId, @Body() dto: CreateReviewDto, @Req() req)
  
  // GET /api/orders/:orderId/review-eligibility
  @Get('orders/:orderId/review-eligibility')
  async checkEligibility(@Param('orderId') orderId)
  
  // GET /api/reviews/public?limit=50
  @Get('reviews/public')
  async listApproved(@Query('limit') limit)
}
```

Note: `@Param('orderId') orderId` — это `orders.id` (UUID), не `orders.orderId` (VB-XXX строка). Existing `OrdersService.findByOrderId` принимает строку `orderId` — нужен `findById(uuid)`. Если такого метода нет, добавляем его в OrdersService (он уже есть, см. `orders.service.ts:findById`).

### 2.6 `ReviewsAdminController`

```typescript
@Controller('admin/reviews')
@UseGuards(AdminAuthGuard)
export class ReviewsAdminController {
  @Get()
  async list(@Query('status') status?: ReviewStatus): Promise<OrderReview[]>
  
  @Get(':id')
  async getById(@Param('id') id: string): Promise<OrderReview>
  
  @Post(':id/approve')
  @HttpCode(200)
  async approve(@Param('id') id, @CurrentAdmin() admin)
  
  @Post(':id/reject')
  @HttpCode(200)
  async reject(@Param('id') id, @CurrentAdmin() admin, @Body() dto: RejectReviewDto)
}
```

### 2.7 DTOs

```typescript
// CreateReviewDto
@IsString() @MinLength(2) @MaxLength(64)
@Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
nickname: string;

@IsInt() @Min(0) @Max(5)
stars: number;

@IsString() @MinLength(10) @MaxLength(1000)
@Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
text: string;

// RejectReviewDto
@IsOptional() @IsString() @MaxLength(500)
reason?: string;
```

### 2.8 Интеграция с `AdminActivityLog`

В существующем `AdminModule` уже есть `AdminActivityLog` (`backend/src/database/entities/admin-activity-log.entity.ts`). `ReviewsService.approve/reject` инжектит его репозиторий и пишет:

```typescript
{
  adminId,
  action: 'review.approve' | 'review.reject',
  resourceType: 'order_review',
  resourceId: review.id,
  metadata: { reason?: string }, // только для reject
  createdAt: new Date(),
}
```

`AdminModule` уже экспортирует repository через `TypeOrmModule.forFeature([AdminActivityLog])`. `ReviewsModule` импортирует `AdminModule` через `forwardRef(() => AdminModule)`.

### 2.9 Rate-limit реализация

Простая, без Redis (используем БД, которая и так есть):

```typescript
private async checkRateLimit(ip: string): Promise<void> {
  if (!ip) return; // testing fallback
  const threshold = await this.settingsService.getNumber(
    'reviews.rate_limit.threshold', 5
  );
  const windowSec = await this.settingsService.getNumber(
    'reviews.rate_limit.window_seconds', 3600
  );
  const since = new Date(Date.now() - windowSec * 1000);
  const count = await this.orderReviewRepo
    .createQueryBuilder('r')
    .where('r.ip_address = :ip', { ip })
    .andWhere('r.created_at > :since', { since })
    .getCount();
  if (count >= threshold) {
    throw new HttpException('Слишком много заявок', HttpStatus.TOO_MANY_REQUESTS);
  }
}
```

Получение IP в контроллере: `req.ip` (Express) с учётом `app.set('trust proxy', true)` если включён прокси (можно оставить как есть — IP может быть прокси-IP, и это всё равно остановит абуз от одного источника).

---

## 3. Frontend Architecture (Next.js)

### 3.1 Лендинг — секция отзывов

**Где разместить:** между секцией `#live` («Последние успешные выдачи») и `#faq` («Вопросы перед покупкой»). Это естественное место — после демонстрации скорости и до закрывающих сомнений.

**Новый компонент:** `frontend/src/components/landing/ReviewsCarousel.tsx`

```tsx
'use client';

interface PublicReview {
  id: string;
  nickname: string;
  stars: number;
  text: string;
  createdAt: string;
}

export default function ReviewsCarousel() {
  const [reviews, setReviews] = useState<PublicReview[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  
  // Fetch on mount
  useEffect(() => {
    fetch(`${API_URL}/reviews/public?limit=50`)
      .then(r => r.json())
      .then(body => setReviews(body.data ?? []))
      .catch(() => {/* graceful: stay empty */});
  }, []);
  
  // Auto-rotate every 6s when not paused and >= 2 reviews
  useEffect(() => {
    if (paused || reviews.length < 2) return;
    const t = setInterval(() => {
      setActiveIndex(i => (i + 1) % reviews.length);
    }, 6000);
    return () => clearInterval(t);
  }, [paused, reviews.length]);
  
  // Empty state per Requirement 2
  if (reviews.length === 0) return <EmptyReviewCard />;
  
  // Render carousel: track + dots + prev/next buttons + swipe handlers
  return (
    <section
      className="reviews-carousel"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      ...
    </section>
  );
}
```

**Карточка отзыва:**
- Никнейм (большой)
- Звёзды: 5 SVG-звёзд, заполненные = stars, остальные пустые
- Текст: если ≤240 символов — показать целиком; если больше — показать `text.slice(0, 240) + '…'` + кнопка «…читать дальше», по клику разворачивается inline (паузим карусель пока раскрыто).
- Дата: `new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long' }).format(new Date(createdAt))`

**Стили:** glass card, тёмная тема, фиолетовый акцент (как остальной лендинг). Высота карточки фиксирована, чтобы не дёргался layout при ротации.

**Свайп на тачах:** простой `onTouchStart` / `onTouchEnd`, разница X > 50px → next/prev.

**Empty state:**
```tsx
function EmptyReviewCard() {
  return (
    <div className="reviews-empty">
      <div className="reviews-empty-icon">★</div>
      <p className="reviews-empty-text">Здесь мог отображаться ваш отзыв</p>
      <p className="reviews-empty-cta">
        Совершите покупку и станьте первым, кто оставит отзыв.
      </p>
    </div>
  );
}
```

**Подключение в `page.tsx`:** между секциями `#live` и `#faq` добавить `<ReviewsCarousel />`. Никаких изменений рельса (4 точки уже привязаны к `top/packages/trust/faq`).

### 3.2 Форма отправки на странице заказа

**Файл:** `frontend/src/app/order/[orderId]/timeline/page.tsx` уже существует. Расширяем.

**Новый компонент:** `frontend/src/components/order/ReviewSubmissionCard.tsx`

```tsx
'use client';

interface Props {
  orderId: string; // UUID или VB-XXX — какой бэкенду удобнее
}

export default function ReviewSubmissionCard({ orderId }: Props) {
  const [eligibility, setEligibility] = useState<EligibilityState>({ kind: 'loading' });
  const [nickname, setNickname] = useState('');
  const [stars, setStars] = useState<number | null>(null);
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  
  useEffect(() => {
    fetch(`${API_URL}/orders/${orderId}/review-eligibility`)
      .then(r => r.json())
      .then(body => setEligibility({ kind: 'ready', data: body.data }));
  }, [orderId]);
  
  // ...
}
```

Состояния:
- `loading` — пока чек не пришёл
- `not_completed` → не показываем ничего (за исключением Requirement 3.2: вообще не рендерим)
- `already_reviewed` → показываем «Спасибо, вы уже оставили отзыв»
- `window_expired` → не показываем ничего (Requirement 3.4)
- `eligible` → показываем форму с CTA «Оставить отзыв». Кнопка раскрывает форму инлайн (или модалка — на твой выбор; инлайн проще).

**Звёзды:** 6 кнопок с tabindex (0..5). На hover — превью заливки. На click — фиксируем выбор. Доступно с клавиатуры (стрелки + Enter).

**Submit:**
```typescript
async function handleSubmit() {
  // Client validation per Requirement 4.6
  const errs = validate({ nickname, stars, text });
  if (Object.keys(errs).length) return setErrors(errs);
  
  setSubmitting(true);
  try {
    const res = await fetch(`${API_URL}/orders/${orderId}/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname, stars, text }),
    });
    if (res.ok) {
      setSubmitted(true);
      return;
    }
    const body = await res.json().catch(() => ({}));
    if (res.status === 429) setErrors({ _form: 'Слишком много заявок. Попробуйте позже.' });
    else setErrors({ _form: body.message ?? 'Не удалось отправить отзыв' });
  } finally {
    setSubmitting(false);
  }
}
```

После успеха показываем «Отзыв отправлен на модерацию. Спасибо!»

### 3.3 Admin модерация

**Файл:** `frontend/src/app/admin/reviews/page.tsx`

- Таб-фильтр: «На модерации» (pending), «Одобрено» (approved), «Отклонено» (rejected)
- Таблица: дата, никнейм, звёзды, текст (truncated с expand), статус, действия
- Действия для pending: «✓ Одобрить», «✕ Отклонить» (модалка с опциональной причиной)
- Использует существующий `api` axios instance с Bearer токеном (как остальные admin страницы)

**Endpoints:**
- `GET /api/admin/reviews?status=pending` → список
- `POST /api/admin/reviews/:id/approve`
- `POST /api/admin/reviews/:id/reject` body `{ reason? }`

Вернуть обновлённую сущность чтобы UI заменил строку без рефетча.

**В sidebar админки** (если есть) добавить пункт «Отзывы» с бейджем количества pending.

---

## 4. Wiring & Integration

### 4.1 Регистрация модуля

`backend/src/app.module.ts`:
```typescript
imports: [
  ...
  ReviewsModule,
],
```

`ReviewsModule`:
```typescript
@Module({
  imports: [
    TypeOrmModule.forFeature([OrderReview]),
    forwardRef(() => OrdersModule),  // нужен Order repo для eligibility
    forwardRef(() => AdminModule),   // AdminAuthGuard + AdminActivityLog
    forwardRef(() => SettingsModule), // rate-limit config (если используем)
  ],
  providers: [ReviewsService, ReviewsEligibilityService],
  controllers: [ReviewsPublicController, ReviewsAdminController],
  exports: [ReviewsService],
})
export class ReviewsModule {}
```

### 4.2 Миграция

```
backend/src/database/migrations/<timestamp>-AddOrderReviewsTable.ts
```

`up()`:
- Создать ENUM `order_reviews_status_enum`
- CREATE TABLE order_reviews со всеми колонками + FK + UNIQUE + INDEX'ы
- Опционально: INSERT в `settings` дефолтные значения rate-limit

`down()`:
- DROP TABLE order_reviews
- DROP TYPE order_reviews_status_enum
- (settings rows trivial — можно не трогать)

### 4.3 Frontend API helper

В `frontend/src/lib/api.ts` добавить:

```typescript
export const reviewsApi = {
  listPublic: () => api.get('/reviews/public?limit=50').then(r => r.data),
  
  checkEligibility: (orderId: string) =>
    api.get(`/orders/${orderId}/review-eligibility`).then(r => r.data),
  
  submit: (orderId: string, payload: { nickname: string; stars: number; text: string }) =>
    api.post(`/orders/${orderId}/reviews`, payload).then(r => r.data),
  
  // admin
  listAdmin: (status?: string) =>
    api.get('/admin/reviews', { params: status ? { status } : {} }).then(r => r.data),
  
  approve: (id: string) =>
    api.post(`/admin/reviews/${id}/approve`).then(r => r.data),
  
  reject: (id: string, reason?: string) =>
    api.post(`/admin/reviews/${id}/reject`, { reason }).then(r => r.data),
};
```

---

## 5. Privacy & Security

- **Public endpoint** возвращает только `{ id, nickname, stars, text, createdAt }` (DTO, не entity). `orderId`, `email`, `ip`, `userAgent`, `moderatedBy`, статусные timestamps скрыты (Requirement 7.1–7.3).
- **Submission endpoint** принимает только `{ nickname, stars, text }`. orderId — параметр URL. IP читаем из `req.ip` сервером, никогда не из тела.
- **Server-side validation** дублирует клиентскую (Requirement 4.7, 5.*) — class-validator декораторы + transform для trim.
- **HTML экранируется** автоматически React'ом при рендере как `{text}` — мы не используем `dangerouslySetInnerHTML`. На сервере храним plain text как есть; никаких санитайзеров не нужно (нет HTML рендеринга).
- **Rate-limit** на per-IP basis (Requirement 8.4).
- **One-review-per-order** на DB-уровне через UNIQUE constraint (Requirement 6.2). Race-проверка на app-уровне в `eligibilityService` плюс трэп `23505` → `ConflictException` в service.

---

## 6. Visual Design

Карусель и форма используют существующую палитру:
- Background: `#050507`, glass cards `bg-white/[.025]` + `border-white/10`
- Accent: `#8f5cff` → `#6d42e8` (фиолет градиент)
- Звёзды: `#fbbf24` (золото) для активных, `rgba(255,255,255,.15)` для пустых
- Empty state: фиолетовая обводка с pulsing animation как у `is-ok` карточек статуса

Карусель fixed-height ~280px, чтобы layout не дёргался. Transition между слайдами: fade + slide на 30px (250ms ease).

---

## 7. Property-Based Testing (опционально для v1)

Свойства, если хотим закрыть PBT:
- **P1 — One review per order**: попытка отправить два отзыва на один orderId всегда даёт ровно одну запись.
- **P2 — Validation symmetry**: client validation и server validation отвергают одинаковые невалидные значения.
- **P3 — Public endpoint privacy**: ответ публичного endpoint никогда не содержит ключей `orderId`, `email`, `ip`, `userAgent`.
- **P4 — Approve idempotency**: повторный approve уже approved отзыва бросает ConflictException, не меняет timestamps.

PBT для v1 необязательно — отзывы менее критичны чем балансы/комиссии в партнёрской программе. Оставим как best-practice если время будет.

---

## 8. Migration & Rollout Plan

1. Run migration `AddOrderReviewsTable`.
2. Deploy backend with `ReviewsModule`.
3. Deploy frontend: добавить `<ReviewsCarousel />` на лендинг, `ReviewSubmissionCard` на order timeline, `/admin/reviews` страницу.
4. Перед продом — проверить: в пустой БД лендинг показывает empty card; завершить тестовый заказ, отправить отзыв, одобрить в админке, обновить лендинг — отзыв появился в карусели.

Никаких breaking changes для существующих модулей. ReviewsModule изолирован.
