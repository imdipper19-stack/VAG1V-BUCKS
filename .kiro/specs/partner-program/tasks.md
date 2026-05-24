# Tasks

## Task 1: Database migrations — new partner tables
Create TypeORM migrations for all new partner-program tables.

- [x] 1.1 Create migration `AddPartnerTables`: tables `partners`, `partner_promo_codes`, `partner_applications`, `commission_entries`, `payout_requests`, `partner_audit_log` with all columns, indexes, and foreign keys as specified in design.md §1.1
- [x] 1.2 Create migration `AddPartnerFieldsToOrders`: add 5 nullable columns to `orders` table (`partner_id`, `promo_code_snapshot`, `discount_rate_snapshot`, `commission_rate_snapshot`, `discount_amount`) as specified in design.md §1.2
- [x] 1.3 Add `down()` rollback methods to both migrations

## Task 2: Backend entities and PartnerModule scaffold
Create TypeORM entities and the NestJS module skeleton.

- [x] 2.1 Create `backend/src/partner/entities/partner.entity.ts` — maps `partners` table
- [x] 2.2 Create `backend/src/partner/entities/partner-promo-code.entity.ts` — maps `partner_promo_codes` table
- [x] 2.3 Create `backend/src/partner/entities/partner-application.entity.ts` — maps `partner_applications` table
- [x] 2.4 Create `backend/src/partner/entities/commission-entry.entity.ts` — maps `commission_entries` table
- [x] 2.5 Create `backend/src/partner/entities/payout-request.entity.ts` — maps `payout_requests` table
- [x] 2.6 Create `backend/src/partner/entities/partner-audit-log.entity.ts` — maps `partner_audit_log` table
- [x] 2.7 Create `backend/src/partner/partner.module.ts` — registers all entities, declares and exports all services and controllers
- [x] 2.8 Register `PartnerModule` in `app.module.ts`

**Depends on:** Task 1

## Task 3: PromoCodeService
Implement promo code generation, validation, and regeneration.

- [x] 3.1 Create `backend/src/partner/promo-code.service.ts` with methods: `generate(partnerId)`, `validate(code)`, `regenerate(partnerId)` as specified in design.md §2.2
- [x] 3.2 `generate()` uses `[A-Z0-9]` charset, length 8, up to 10 retry attempts, throws on exhaustion (Requirement 8.4–8.5)
- [x] 3.3 `validate(code)` returns partner + discountRate or throws `NotFoundException` / `BadRequestException` for disabled partner
- [x] 3.4 `regenerate()` sets old code `is_current=false`, creates new code, writes audit log entry

**Depends on:** Task 2

## Task 4: PartnerAuthService and PartnerAuthGuard
Implement invite-link password flow, JWT login, and route guard.

- [x] 4.1 Create `backend/src/partner/partner-auth.service.ts` with: `generateInviteToken()`, `setPasswordViaInvite()`, `login()`, `generateJwt()`, `verifyJwt()` as specified in design.md §2.2 and §4
- [x] 4.2 Password hashing uses `bcrypt` with rounds=12 (Requirement 11.5)
- [x] 4.3 JWT payload: `{ sub, username, role: 'partner' }`, signed with `JWT_SECRET`, TTL 24h
- [x] 4.4 `login()` rejects disabled partners with appropriate error message (Requirement 11.6)
- [x] 4.5 Create `backend/src/partner/guards/partner-auth.guard.ts` — reads `partner_token` cookie, verifies JWT, checks `role === 'partner'`
- [x] 4.6 Create `backend/src/partner/decorators/current-partner.decorator.ts`

**Depends on:** Task 2

## Task 5: PartnerApplicationService
Implement application submission and admin review workflow.

- [x] 5.1 Create `backend/src/partner/partner-application.service.ts` with: `submit(dto)`, `list(filters)`, `getById(id)`, `approve(id, adminId, params)`, `reject(id, adminId)`
- [x] 5.2 `approve()` creates Partner record, calls `PromoCodeService.generate()`, calls `PartnerAuthService.generateInviteToken()`, writes audit log
- [x] 5.3 `approve()` and `reject()` throw `ConflictException` if application status is not `pending` (Requirement 5.7)
- [x] 5.4 Create DTOs: `CreateApplicationDto` (with class-validator decorators for URL format and TG username `@` prefix), `ApproveApplicationDto`

**Depends on:** Task 3, Task 4

## Task 6: PartnerService — partner management
Implement partner CRUD and parameter management for admin.

- [x] 6.1 Create `backend/src/partner/partner.service.ts` with: `create(dto)`, `list()`, `getById(id)`, `updateRates(id, dto)`, `toggleStatus(id)`, `getStats(id)`
- [x] 6.2 `create()` generates promo code and invite token, validates promo code uniqueness (Requirement 6.3)
- [x] 6.3 `updateRates()` validates each rate in `[0, 1]` and `discountRate + commissionRate <= 1` (Requirement 7.7–7.8)
- [x] 6.4 `getStats()` returns `partnerBalance`, `pendingBalance`, `totalEarned`, `totalPaid`, order counts
- [x] 6.5 Create DTOs: `CreatePartnerDto`, `UpdatePartnerDto`

**Depends on:** Task 3, Task 4

## Task 7: CommissionService
Implement commission lifecycle tied to order status transitions.

- [x] 7.1 Create `backend/src/partner/commission.service.ts` with: `createPending(orderId, partnerId, amount)`, `approve(orderId)`, `cancel(orderId)`
- [x] 7.2 `createPending()` uses `INSERT ... ON CONFLICT (order_id) DO NOTHING` for idempotency (Requirement 10.5, 16.6)
- [x] 7.3 `approve()` and `cancel()` only transition from `pending`; repeated calls on already-final status are no-ops (Requirement 16.6)
- [x] 7.4 Both methods write to `partner_audit_log` with timestamps (Requirement 17.4)
- [x] 7.5 Export `CommissionService` from `PartnerModule`

**Depends on:** Task 2

## Task 8: PayoutService
Implement payout request creation and status management.

- [x] 8.1 Create `backend/src/partner/payout.service.ts` with: `create(partnerId, dto)`, `getBalance(partnerId)`, `list(filters)`, `updateStatus(payoutId, newStatus, adminId, reason?)`
- [x] 8.2 `create()` validates `amount > 0` and `amount <= getBalance(partnerId)` (Requirement 13.3–13.4)
- [x] 8.3 `getBalance()` computes dynamically: `SUM(approved commissions) - SUM(paid+requested+processing payouts)` (Requirement 16.3)
- [x] 8.4 `updateStatus()` enforces state machine: `requested→processing→paid`, `requested/processing→rejected`; throws on invalid transitions (Requirement 14.6)
- [x] 8.5 Repeated call with same terminal status is a no-op (idempotency, Requirement 16.5)
- [x] 8.6 `rejected` transition writes audit log (Requirement 17.3)

**Depends on:** Task 2

## Task 9: Integration hook in OrderProcessingService
Wire CommissionService into the existing order processing pipeline.

- [x] 9.1 Inject `CommissionService` into `OrderProcessingService` via module imports
- [x] 9.2 In order creation flow (controller or service): if `promoCode` provided, call `PromoCodeService.validate()`, attach `partnerId`, `promoCodeSnapshot`, `discountRateSnapshot`, `commissionRateSnapshot`, `discountAmount` to order
- [x] 9.3 In `handleSuccess()`: if `order.partnerId` set, call `commissionService.approve(order.id)`
- [x] 9.4 In `handleFailure()` and `markFailed()`: if `order.partnerId` set, call `commissionService.cancel(order.id)`
- [x] 9.5 In order creation: if `order.partnerId` set, call `commissionService.createPending(order.id, order.partnerId, amount)` where `amount = order.priceRUB * order.commissionRateSnapshot`

**Depends on:** Task 7, Task 3

## Task 10: Public and partner cabinet controllers
Implement REST controllers for public endpoints and partner cabinet.

- [x] 10.1 Create `backend/src/partner/partner-public.controller.ts`:
  - `POST /api/partner/applications` → `PartnerApplicationService.submit()`
  - `POST /api/partner/auth/login` → `PartnerAuthService.login()`, sets `partner_token` cookie
  - `POST /api/partner/auth/set-password` → `PartnerAuthService.setPasswordViaInvite()`
  - `GET /api/partner/auth/invite-info?token=` → validate token, return partner display name
- [x] 10.2 Create `backend/src/partner/partner-cabinet.controller.ts` (guarded by `PartnerAuthGuard`):
  - `GET /api/partner/dashboard` → balance, stats, promo code, rates
  - `GET /api/partner/orders` → paginated order history
  - `GET /api/partner/payouts` → payout history
  - `POST /api/partner/payouts` → `PayoutService.create()`
- [x] 10.3 Add `POST /api/orders/validate-promo` to existing `OrdersController` — calls `PromoCodeService.validate()`

**Depends on:** Task 5, Task 6, Task 8

## Task 11: Admin partner controllers
Implement REST controllers for admin partner management.

- [x] 11.1 Create `backend/src/partner/partner-admin.controller.ts` (guarded by existing `AdminAuthGuard`):
  - Applications CRUD: list, get, approve, reject
  - Partners CRUD: list, create, get, update rates/status, regenerate code, get invite link
  - Payouts: list with filter, update status
- [x] 11.2 All write actions validate input via DTOs with class-validator
- [x] 11.3 Approve action returns `inviteLink` in response so admin can copy and send to partner

**Depends on:** Task 5, Task 6, Task 8

## Task 12: Header and Footer components with TG link and partner button
Refactor layout to shared components and add new navigation elements.

- [x] 12.1 Extract `<nav>` from `frontend/src/app/page.tsx` into `frontend/src/components/layout/Header.tsx`
- [x] 12.2 Extract `<footer>` from `frontend/src/app/page.tsx` into `frontend/src/components/layout/Footer.tsx`
- [x] 12.3 Add TG channel link `https://t.me/FortnitebucksShop` to Header with Telegram icon, `target="_blank"`, `rel="noopener noreferrer"` (Requirement 1.1, 1.4, 1.6)
- [x] 12.4 Add TG channel link to Footer with same attributes (Requirement 1.2, 1.5)
- [x] 12.5 Add «Стать партнёром» button/link to Header → `/partner` (Requirement 2.1)
- [x] 12.6 Add «Стать партнёром» button/link to Footer → `/partner` (Requirement 2.2)
- [x] 12.7 Import Header and Footer in `frontend/src/app/layout.tsx` so they appear on all pages
- [x] 12.8 Update `page.tsx` to use the new shared components (remove inline nav/footer)

## Task 13: Partner landing page `/partner`
Build the public partner landing page with application form.

- [x] 13.1 Create `frontend/src/app/partner/page.tsx` — public route, no auth required (Requirement 3.1)
- [x] 13.2 Add program description section: how it works, who it's for, approval process (Requirement 3.2)
- [x] 13.3 Add application form with fields: display name, platform type (select), platform URL, audience size, TG contact, description (Requirement 3.3–3.4)
- [x] 13.4 Client-side validation: required fields, URL format (`http`/`https`), TG username starts with `@` (Requirement 4.2–4.4)
- [x] 13.5 On submit: `POST /api/partner/applications`, show success confirmation on 201 (Requirement 4.6)
- [x] 13.6 Add «Войти в кабинет партнёра» link → `/partner/login` (Requirement 3.5)

**Depends on:** Task 10

## Task 14: Partner login and invite pages
Build authentication pages for partner cabinet.

- [x] 14.1 Create `frontend/src/app/partner/login/page.tsx` — login form (username + password), calls `POST /api/partner/auth/login`, redirects to `/partner/cabinet` on success (Requirement 11.1, 11.3–11.4)
- [x] 14.2 Create `frontend/src/app/partner/invite/page.tsx` — reads `?token=` from URL, calls `GET /api/partner/auth/invite-info`, shows set-password form, calls `POST /api/partner/auth/set-password` (Requirement 11.2)
- [x] 14.3 Create `frontend/src/app/partner/cabinet/layout.tsx` — checks for `partner_token` cookie, redirects to `/partner/login` if missing

**Depends on:** Task 10

## Task 15: Partner cabinet pages
Build the partner dashboard, order history, and payout pages.

- [x] 15.1 Create `frontend/src/app/partner/cabinet/page.tsx` — dashboard: Partner_Balance, Pending_Balance, Total_Earned, Total_Paid, promo code, discount_rate, commission_rate (Requirement 12.1)
- [x] 15.2 Create `frontend/src/app/partner/cabinet/orders/page.tsx` — paginated order history: date, amount, commission amount, commission status (Requirement 12.2–12.3)
- [x] 15.3 Create `frontend/src/app/partner/cabinet/payouts/page.tsx` — payout history + «Запросить выплату» form: amount + requisites fields, validation, submit (Requirement 12.4, 13.1–13.5)

**Depends on:** Task 14

## Task 16: Promo code field in checkout
Add promo code input to the payment/checkout flow.

- [x] 16.1 Add promo code input + «Применить» button to `frontend/src/app/payment/page.tsx` (Requirement 9.1)
- [x] 16.2 On «Применить»: call `POST /api/orders/validate-promo`, show discount amount or error message (Requirement 9.2–9.5)
- [x] 16.3 Pass `promoCode` in order creation request body when code is applied (Requirement 9.6)
- [x] 16.4 Show «Промокод не найден» / «Промокод неактивен» messages per spec (Requirement 9.3–9.4)
- [x] 16.5 When no promo code applied, calculate total without discount (Requirement 9.8)

**Depends on:** Task 10

## Task 17: Admin partner management pages
Build admin UI pages for partner program management.

- [x] 17.1 Create `frontend/src/app/admin/applications/page.tsx` — list of applications with status filter, approve/reject actions with modal for rates input (Requirement 5.1–5.7)
- [x] 17.2 Create `frontend/src/app/admin/partners/page.tsx` — list of partners with key fields, «Создать партнёра вручную» button (Requirement 6.1, 7.1)
- [x] 17.3 Create `frontend/src/app/admin/partners/[id]/page.tsx` — partner detail: stats, edit rates/status, regenerate code, copy invite link, order history, payout history (Requirement 7.2–7.8, 15.1–15.4)
- [x] 17.4 Create `frontend/src/app/admin/payouts/page.tsx` — payout requests list with status filter, «Взять в работу» / «Отметить выплаченной» / «Отклонить» actions (Requirement 14.1–14.7)

**Depends on:** Task 11

## Task 18: PBT tests for correctness properties
Write property-based tests covering the 6 invariants from design.md §5.

- [x] 18.1 Set up `fast-check` in `backend/src/partner/__tests__/` with Jest + TypeORM in-memory SQLite config
- [x] 18.2 P1 — Balance invariant: generate random sequences of completed/failed orders and paid/rejected payouts, assert `getBalance()` equals manual sum
- [x] 18.3 P2 — Non-negative balance: attempt payout with `amount > balance`, assert system always rejects
- [x] 18.4 P3 — Commission idempotency: call `approve(orderId)` twice, assert `totalEarned` unchanged on second call
- [x] 18.5 P4 — Payout idempotency: call `markPaid(payoutId)` twice, assert `paid_at` and balance unchanged on second call
- [x] 18.6 P5 — Promo code uniqueness: generate N codes concurrently, assert no duplicates in DB
- [x] 18.7 P6 — Snapshot correctness: create orders with varying commission_rate, assert `commission_entry.amount = price * commission_rate_snapshot`

**Depends on:** Task 7, Task 8, Task 3
