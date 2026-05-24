import { IsNumber, IsOptional, IsString, IsUrl, Matches } from 'class-validator';

export class CreateOrderDto {
  @IsNumber()
  vbucksAmount: number;

  @IsNumber()
  priceTRY: number;

  @IsOptional()
  @IsString()
  sellerId?: string;

  @IsOptional()
  @IsUrl()
  webhookUrl?: string;

  /**
   * Optional partner promo code applied at checkout.
   *
   * Format mirrors `PromoCodeService.PROMO_CODE_CHARSET` — upper-case
   * Latin letters and digits only, length 6..16 (Requirement 8.2).
   * Validation here rejects obviously malformed input before we hit the
   * DB lookup; semantic validation (existence, partner status) is done
   * by `PromoCodeService.validate()`.
   */
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z0-9]{6,16}$/, {
    message: 'promoCode must be 6-16 uppercase Latin letters or digits',
  })
  promoCode?: string;
}
