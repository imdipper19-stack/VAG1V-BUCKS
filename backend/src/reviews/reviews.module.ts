import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OrderReview } from './entities/order-review.entity';
import { ReviewsAdminController } from './reviews-admin.controller';
import { ReviewsPublicController } from './reviews-public.controller';
import { ReviewsService } from './reviews.service';
import { ReviewsEligibilityService } from './reviews-eligibility.service';
import { AdminModule } from '../admin/admin.module';
import { OrdersModule } from '../orders/orders.module';
import { AdminActivityLog } from '../database/entities/admin-activity-log.entity';

/**
 * ReviewsModule — order review submission, moderation, and public listing.
 *
 * Currently wired:
 *
 *   - `OrderReview` repository + `AdminActivityLog` repository
 *     (the latter is needed by `ReviewsService.approve/reject` for
 *     audit-log writes inside the moderation transaction).
 *   - `ReviewsEligibilityService` — completed/window/already-reviewed
 *     gate, exported so future controllers can read the eligibility
 *     descriptor for the order timeline page.
 *   - `ReviewsService` — submission + public listing + moderation,
 *     exported for any future cross-module consumer.
 *   - `ReviewsPublicController` — buyer submission, eligibility check,
 *     landing-carousel listing. Resolves `Order.orderId` (`VB-...`) →
 *     UUID before calling into the service layer.
 *   - `ReviewsAdminController` — moderation surface, guarded by
 *     `AdminAuthGuard` exported from `AdminModule`.
 *
 * `forwardRef` is used for both AdminModule and OrdersModule because the
 * dependency graph is bidirectional in spirit (admin guard + activity log
 * live in AdminModule; order lookups live in OrdersModule which itself
 * imports AdminModule). Keeping the refs lazy avoids module-init cycles
 * if any future task wires the reverse direction.
 *
 * Re-exports `TypeOrmModule` so other modules can inject the
 * `OrderReview` repository without re-declaring `forFeature`.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([OrderReview, AdminActivityLog]),
    forwardRef(() => OrdersModule),
    forwardRef(() => AdminModule),
  ],
  controllers: [ReviewsPublicController, ReviewsAdminController],
  providers: [ReviewsEligibilityService, ReviewsService],
  exports: [ReviewsEligibilityService, ReviewsService, TypeOrmModule],
})
export class ReviewsModule {}
