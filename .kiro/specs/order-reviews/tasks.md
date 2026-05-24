# Tasks

## Task 1: Database migration — order_reviews table
Create the TypeORM migration for the new `order_reviews` table.

- [x] 1.1 Create migration `<timestamp>-AddOrderReviewsTable.ts` in `backend/src/database/migrations/`. Creates ENUM `order_reviews_status_enum` ('pending','approved','rejected'), table `order_reviews` with all columns from design.md §1.1, FK to orders.id ON DELETE CASCADE, FK to admins.id ON DELETE SET NULL for moderated_by, UNIQUE on order_id, indexes on status, (status, created_at), (ip_address, created_at).
- [x] 1.2 Add `down()` rollback that drops the table and the ENUM type.
- [x] 1.3 Add default settings rows: `INSERT INTO settings (key, value) VALUES ('reviews.rate_limit.threshold', '5'), ('reviews.rate_limit.window_seconds', '3600') ON CONFLICT DO NOTHING`. (Skip if SettingsModule doesn't use a key/value table — fall back to env constants in service.)

## Task 2: OrderReview entity
- [x] 2.1 Create `backend/src/reviews/entities/order-review.entity.ts` with `OrderReview` class and `ReviewStatus` enum per design.md §2.2. Use `enumName: 'order_reviews_status_enum'`, `@Index` decorators matching the migration index names.

**Depends on:** Task 1

## Task 3: ReviewsModule scaffold
- [x] 3.1 Create `backend/src/reviews/reviews.module.ts` with `TypeOrmModule.forFeature([OrderReview])`, `forwardRef(() => OrdersModule)`, `forwardRef(() => AdminModule)`. Empty `providers`/`controllers` for now.
- [x] 3.2 Register `ReviewsModule` in `backend/src/app.module.ts`.

**Depends on:** Task 2

## Task 4: ReviewsEligibilityService
- [x] 4.1 Create `backend/src/reviews/reviews-eligibility.service.ts` with methods `checkOrderEligibility(orderId)` returning `{ canSubmit, reason?, alreadyReviewed }` and `assertCanSubmit(orderId)` throwing `BadRequestException` per design.md §2.3.
- [x] 4.2 `DELIVERY_WINDOW_MS = 30 * 24 * 3600 * 1000`. Load order via OrdersService.findById; check `status === 'completed'` (Requirement 3.5), `now - completedAt <= DELIVERY_WINDOW_MS` (Requirement 3.6, 8.2), and `count(reviews WHERE order_id = ?) === 0` (Requirement 3.7).
- [x] 4.3 Add to ReviewsModule providers.

**Depends on:** Task 3

## Task 5: ReviewsService
- [x] 5.1 Create `backend/src/reviews/reviews.service.ts` with `submit/listApproved/listForModeration/getById/approve/reject` methods per design.md §2.4.
- [x] 5.2 `submit()` calls eligibilityService.assertCanSubmit, runs rate-limit check via DB count by ip+window (design.md §2.9), trims nickname/text, inserts. Catches PG `23505` → ConflictException.
- [x] 5.3 `listApproved(limit?)` returns mapped DTOs (only id/nickname/stars/text/createdAt) for Requirement 7.1.
- [x] 5.4 `approve(id, adminId)` and `reject(id, adminId, reason?)` use a transaction: load → check `status === 'pending'` (Requirement 10.10) → update → write to AdminActivityLog with action `review.approve`/`review.reject` (Requirement 10.3, 10.7).
- [x] 5.5 Add to ReviewsModule providers and exports.

**Depends on:** Task 4

## Task 6: DTOs
- [x] 6.1 Create `backend/src/reviews/dto/create-review.dto.ts` with class-validator: nickname (string, min 2, max 64, trim transform), stars (int, 0..5), text (string, min 10, max 1000, trim transform).
- [x] 6.2 Create `backend/src/reviews/dto/reject-review.dto.ts` with optional `reason` (string, max 500).
- [ ] 6.3 Create `backend/src/reviews/dto/public-review.dto.ts` — TypeScript type for the public response shape.

**Depends on:** Task 2

## Task 7: ReviewsPublicController
- [x] 7.1 Create `backend/src/reviews/reviews-public.controller.ts` with three endpoints per design.md §2.5: `POST /api/orders/:orderId/reviews`, `GET /api/orders/:orderId/review-eligibility`, `GET /api/reviews/public?limit=50`.
- [x] 7.2 Submit endpoint extracts `req.ip` and `req.headers['user-agent']`, passes to ReviewsService.submit. Apply ValidationPipe via DTO.
- [x] 7.3 Wire controller in ReviewsModule.

**Depends on:** Task 5, Task 6

## Task 8: ReviewsAdminController
- [x] 8.1 Create `backend/src/reviews/reviews-admin.controller.ts` guarded by `AdminAuthGuard`. Endpoints: `GET /api/admin/reviews?status=`, `GET /api/admin/reviews/:id`, `POST /api/admin/reviews/:id/approve`, `POST /api/admin/reviews/:id/reject` per design.md §2.6.
- [x] 8.2 Use `@CurrentAdmin()` decorator from existing admin module to pass adminId to service methods.
- [x] 8.3 Wire controller in ReviewsModule.

**Depends on:** Task 5

## Task 9: Backend tests (smoke)
- [x] 9.1 Add Jest spec `reviews.service.spec.ts` with at minimum: submit creates pending review, second submit on same orderId throws ConflictException, eligibility for non-completed order rejects, approve transitions to approved + writes AdminActivityLog row.

**Depends on:** Task 5, Task 8

## Task 10: Frontend — public reviews carousel component
- [x] 10.1 Create `frontend/src/components/landing/ReviewsCarousel.tsx` per design.md §3.1: fetch `/api/reviews/public?limit=50` on mount, store reviews + activeIndex + paused state, auto-rotate every 6s when paused=false and reviews.length >= 2 (Requirement 1.6, 1.7), hover handlers, swipe gesture handlers, prev/next on-screen controls (Requirement 1.8).
- [x] 10.2 Render review card: nickname, 5 SVG stars (filled count = stars), text with truncation at 240 chars + «…читать дальше» expand (Requirement 1.5), formatted date.
- [x] 10.3 EmptyReviewCard subcomponent with the exact text «Здесь мог отображаться ваш отзыв» (Requirement 2.2) and short CTA, no rotation (Requirement 2.4).
- [x] 10.4 Glass-card styling matching the partner landing palette (#050507 bg, #8f5cff accent). Fixed card height ~280px so layout doesn't shift on rotate.

## Task 11: Frontend — wire carousel into landing page
- [x] 11.1 Import `<ReviewsCarousel />` in `frontend/src/app/page.tsx` and place between section `#live` and section `#faq` (the `landing-section.landing-reveal` blocks).
- [x] 11.2 Verify rail dots still map correctly to top/packages/trust/faq sections (no change needed — reviews section doesn't have a rail anchor).

**Depends on:** Task 10

## Task 12: Frontend — review submission card on order timeline
- [x] 12.1 Create `frontend/src/components/order/ReviewSubmissionCard.tsx` per design.md §3.2 with eligibility loading state, ineligible states (not_completed → render nothing per Requirement 3.2; window_expired → render nothing per 3.4; already_reviewed → «Спасибо, вы уже оставили отзыв» per 3.3), eligible state with form.
- [x] 12.2 Form: nickname input, star selector (6 buttons for 0..5 with hover preview, keyboard arrow navigation), text textarea with live char count, submit button.
- [x] 12.3 Client-side validation matching server: nickname trim 2..64, stars int 0..5, text trim 10..1000 (Requirement 5).
- [x] 12.4 Submit handler posts to `/api/orders/:orderId/reviews` with nickname/stars/text. On 201 → success state «Отзыв отправлен на модерацию». On 429 → friendly rate-limit message. On 4xx → show backend message.
- [x] 12.5 Mount in `frontend/src/app/order/[orderId]/timeline/page.tsx` after the existing timeline content.

## Task 13: Frontend — admin reviews moderation page
- [x] 13.1 Create `frontend/src/app/admin/reviews/page.tsx` per design.md §3.3 with status filter tabs (Все / На модерации / Одобрено / Отклонено), table (date, nickname, stars rendered as ★★★★☆, text truncated with click-to-expand, status, actions).
- [x] 13.2 Approve action: POST `/admin/reviews/:id/approve` via `api` axios instance, optimistic row update.
- [x] 13.3 Reject action: opens modal with optional reason textarea, POST `/admin/reviews/:id/reject` body `{ reason? }`.
- [x] 13.4 Match existing admin page styling (`frontend/src/app/admin/applications/page.tsx` as reference).

## Task 14: Frontend — API helpers
- [x] 14.1 Add `reviewsApi` block to `frontend/src/lib/api.ts` with methods `listPublic`, `checkEligibility`, `submit`, `listAdmin`, `approve`, `reject` per design.md §4.3. Use these from the new components instead of raw fetch where convenient.

**Depends on:** Task 7, Task 8

## Task 15: End-to-end smoke
- [ ] 15.1 Run migration on dev DB. Verify table created with all columns/indexes/FKs.
- [ ] 15.2 Manual flow: create test order, mark completed (test endpoint), open `/order/<orderId>/timeline`, submit review, verify pending row in DB.
- [ ] 15.3 Open `/admin/reviews?status=pending`, approve the review.
- [ ] 15.4 Open `/`, verify the review appears in the carousel.
- [ ] 15.5 Verify empty state on a fresh DB shows «Здесь мог отображаться ваш отзыв».

**Depends on:** Task 11, Task 12, Task 13, Task 14
