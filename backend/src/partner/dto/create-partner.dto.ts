import {
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Payload for `POST /api/admin/partners` — manual partner creation
 * by Owner (Requirement 6.1–6.3), bypassing the public application
 * form.
 *
 * Field shapes mirror {@link CreateApplicationDto} and
 * {@link ApproveApplicationDto} so the same client-side validation
 * rules apply consistently across the two creation paths.
 *
 * Cross-field rate validation (`discountRate + commissionRate <= 1`,
 * Requirement 7.8) is enforced in `PartnerService.create()` because
 * class-validator does not express cross-field constraints cleanly.
 */
export class CreatePartnerDto {
  /** Display name shown in admin UI and the partner's cabinet. */
  @IsString()
  @MinLength(2)
  @MaxLength(128)
  displayName: string;

  /**
   * Telegram contact for shipping the invite link to the partner.
   * Must look like `@username` (4–32 chars of `[A-Za-z0-9_]`).
   */
  @Matches(/^@[A-Za-z0-9_]{4,32}$/, {
    message:
      'Контакт TG должен начинаться с @ и содержать 4-32 латинских символа/цифры/_',
  })
  contactTg: string;

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
   * Optional cabinet login. When absent, the service derives a
   * username from `displayName` (transliterated, sanitised, suffixed
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
   * Optional explicit promo code (Requirement 6.2). Charset and length
   * mirror Requirement 8.2. Uniqueness is checked at the service layer
   * because it depends on DB state, not the payload alone (Requirement
   * 6.3).
   */
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z0-9]{6,16}$/, {
    message: 'Promo code must be 6-16 chars [A-Z0-9]',
  })
  promoCode?: string;
}
