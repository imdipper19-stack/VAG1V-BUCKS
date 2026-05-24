import { IsEnum, IsNumber, IsOptional, Max, Min } from 'class-validator';

import { PartnerStatusEnum } from '../entities/partner.entity';

/**
 * Payload for `PATCH /api/admin/partners/:id` — admin-side partial
 * update of a Partner's tunable fields (Requirement 7.2–7.4).
 *
 * All fields are optional so a single endpoint can serve "edit rates",
 * "toggle status", or any combination. The caller in
 * {@link PartnerService} fills in unspecified rate fields from the
 * stored partner row before applying the cross-field check
 * `discountRate + commissionRate <= 1` (Requirement 7.7–7.8).
 *
 * Note: status flips also have a dedicated `toggleStatus()` service
 * method that does not consume this DTO; the `status` field here is
 * for cases where the admin UI sends an explicit value rather than
 * relying on a flip.
 */
export class UpdatePartnerDto {
  /** New Discount_Rate. Range `[0, 1]` (Requirement 7.7). */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  discountRate?: number;

  /** New Commission_Rate. Range `[0, 1]` (Requirement 7.7). */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  commissionRate?: number;

  /** New Partner_Status (`active` or `disabled`). */
  @IsOptional()
  @IsEnum(PartnerStatusEnum)
  status?: PartnerStatusEnum;
}
