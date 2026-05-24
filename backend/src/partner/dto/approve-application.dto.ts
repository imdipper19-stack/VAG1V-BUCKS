import {
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

/**
 * Payload for `POST /api/admin/partner-applications/:id/approve` —
 * the parameters an admin chooses when approving a pending application
 * (Requirement 5.4).
 *
 * Decimal-rate fields are validated in `[0, 1]` independently here; the
 * stricter `discountRate + commissionRate <= 1.0` cross-field check is
 * enforced in `PartnerApplicationService.approve()` because it requires
 * comparing two values, which class-validator does not express cleanly.
 *
 * `username` and `promoCode` are optional. When omitted, the service
 * derives a username from the application's display name and asks
 * `PromoCodeService.generate()` to pick a random `[A-Z0-9]{8}` code.
 * When `promoCode` is provided, it bypasses the auto-generator and is
 * persisted verbatim after a uniqueness check.
 */
export class ApproveApplicationDto {
  /** Discount_Rate as a decimal in [0, 1] (e.g. 0.10 = 10%). */
  @IsNumber()
  @Min(0)
  @Max(1)
  discountRate: number;

  /** Commission_Rate as a decimal in [0, 1] (e.g. 0.10 = 10%). */
  @IsNumber()
  @Min(0)
  @Max(1)
  commissionRate: number;

  /**
   * Optional cabinet login. When absent, the service derives a username
   * from `application.displayName` (transliterated, sanitised, suffixed
   * with random hex). Validation here only constrains the shape of an
   * explicitly provided value.
   */
  @IsOptional()
  @IsString()
  @Matches(/^[a-zA-Z0-9_-]{3,64}$/, {
    message: 'Username may contain only [a-zA-Z0-9_-], 3-64 chars',
  })
  username?: string;

  /**
   * Optional explicit promo code (Requirement 5.4). Charset and length
   * mirror Requirement 8.2. Uniqueness is checked at the service layer
   * because it depends on DB state, not the payload alone.
   */
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z0-9]{6,16}$/, {
    message: 'Promo code must be 6-16 chars [A-Z0-9]',
  })
  promoCode?: string;
}
