import { IsNumber, IsString, Matches, Min } from 'class-validator';

/**
 * Payload for `POST /api/orders/validate-promo` — pre-checkout
 * validation so the buyer sees the discount on the payment page
 * BEFORE creating an order (Requirement 9.2).
 *
 * Format constraints mirror `PromoCodeService.PROMO_CODE_CHARSET` and
 * `CreateOrderDto.promoCode` so a payload that passes here will pass
 * the `POST /api/orders` shape check too — the only delta between
 * "validate" and "create" is the order-side fields.
 *
 * `priceTRY` is required so the response can include the absolute
 * `discountAmount` rather than just the rate. The lower bound of 0.01
 * ensures we never multiply by zero or a negative number; in practice
 * the smallest realistic V-Bucks pack puts this in the tens of TRY.
 */
export class ValidatePromoCodeDto {
  @IsString()
  @Matches(/^[A-Z0-9]{6,16}$/, {
    message: 'promoCode must be 6-16 uppercase Latin letters or digits',
  })
  promoCode: string;

  @IsNumber()
  @Min(0.01)
  priceTRY: number;
}
