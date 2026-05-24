import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';

import { Partner } from './entities/partner.entity';
import { PartnerPromoCode } from './entities/partner-promo-code.entity';
import { PartnerApplication } from './entities/partner-application.entity';
import { CommissionEntry } from './entities/commission-entry.entity';
import { PayoutRequest } from './entities/payout-request.entity';
import { PartnerAuditLog } from './entities/partner-audit-log.entity';
import { PromoCodeService } from './promo-code.service';
import { PartnerAuthService } from './partner-auth.service';
import { PartnerApplicationService } from './partner-application.service';
import { PartnerService } from './partner.service';
import { CommissionService } from './commission.service';
import { PayoutService } from './payout.service';
import { PartnerAuthGuard } from './guards/partner-auth.guard';
import { PartnerPublicController } from './partner-public.controller';
import { PartnerCabinetController } from './partner-cabinet.controller';
import { PartnerAdminController } from './partner-admin.controller';
import { OrdersModule } from '../orders/orders.module';
import { AdminModule } from '../admin/admin.module';

/**
 * PartnerModule
 *
 * Registers the six partner-program entities with TypeORM so their
 * repositories can be injected throughout the partner feature, and
 * wires the partner-program services that other modules consume.
 *
 * `TypeOrmModule` is re-exported so other modules (e.g. orders,
 * admin) can `imports: [PartnerModule]` and inject the partner
 * repositories without re-registering the entities. `PromoCodeService`
 * is exported so the orders module can validate codes at checkout
 * (Task 9.2).
 *
 * `PartnerAuthService` is exported so future controllers (login,
 * invite, cabinet) can call it. `PartnerAuthGuard` is exported so
 * controllers in other modules can opt-in via `@UseGuards()` if ever
 * needed; today only routes inside this module use it.
 *
 * Circular dep with OrdersModule:
 * `PartnerCabinetController` reads from the `orders` table via the
 * `Order` repository to surface a partner's order history. `Order` is
 * registered in `OrdersModule.TypeOrmModule.forFeature([Order])`, so
 * we import OrdersModule to get the repo without re-registering the
 * entity. OrdersModule, in turn, already imports
 * `forwardRef(() => PartnerModule)` for `PromoCodeService` and
 * `CommissionService`. Mutual `forwardRef()` resolves both ways at
 * boot time.
 */
@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([
      Partner,
      PartnerPromoCode,
      PartnerApplication,
      CommissionEntry,
      PayoutRequest,
      PartnerAuditLog,
    ]),
    // OrdersModule exports its TypeOrmModule (Order entity) and
    // OrdersService. The cabinet controller injects the Order
    // repository directly to scope the partner's order history.
    forwardRef(() => OrdersModule),
    // AdminModule exports `AdminAuthGuard` for the admin partner
    // controller. forwardRef is defensive — AdminModule does not
    // currently import PartnerModule, but routing this through
    // forwardRef matches the pattern used by AdminModule's other
    // consumers (CommonModule, OrdersModule) and makes future
    // cross-references safe by default.
    forwardRef(() => AdminModule),
  ],
  controllers: [
    PartnerPublicController,
    PartnerCabinetController,
    PartnerAdminController,
  ],
  providers: [
    PromoCodeService,
    PartnerAuthService,
    PartnerApplicationService,
    PartnerService,
    CommissionService,
    PayoutService,
    PartnerAuthGuard,
  ],
  exports: [
    TypeOrmModule,
    PromoCodeService,
    PartnerAuthService,
    PartnerApplicationService,
    PartnerService,
    CommissionService,
    PayoutService,
    PartnerAuthGuard,
  ],
})
export class PartnerModule {}
