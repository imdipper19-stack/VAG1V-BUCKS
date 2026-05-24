import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Partner } from '../entities/partner.entity';

/**
 * CurrentPartner
 *
 * Param decorator mirroring `CurrentAdmin` from the admin module.
 * Pulls the partner attached by {@link PartnerAuthGuard} (`request.partner`)
 * and exposes it to controller handlers as a typed argument.
 *
 * Returns `null` rather than throwing when the property is absent so
 * the decorator stays safe to use on routes where the guard is not
 * applied — guarded routes will always have a non-null partner because
 * the guard short-circuits with `UnauthorizedException` otherwise.
 *
 * Usage:
 *   @Get('dashboard')
 *   @UseGuards(PartnerAuthGuard)
 *   dashboard(@CurrentPartner() partner: Partner) { ... }
 */
export const CurrentPartner = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Partner | null => {
    const request = ctx.switchToHttp().getRequest();
    return request.partner ?? null;
  },
);
