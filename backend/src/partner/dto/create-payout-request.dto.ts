import { IsNumber, IsString, MaxLength, Min, MinLength } from 'class-validator';

/**
 * Payload for `POST /api/partner/payouts` — partner-initiated payout
 * request from inside the cabinet (Requirement 13.1).
 *
 * The amount lower bound (`Min(0.01)`) handles Requirement 13.4
 * ("отказать в создании при сумме <= 0") at the DTO layer; the upper
 * bound (`amount <= partnerBalance`) is enforced at the service layer
 * because it depends on dynamic balance state and cannot be expressed
 * declaratively.
 *
 * `requisites` is intentionally a free-form text field — partners may
 * supply card numbers, e-wallet handles, IBANs, or whatever the Owner
 * negotiated off-channel. The 5–2000 char window is a sanity guard
 * against empty submissions and pathological payloads, not a format
 * check.
 */
export class CreatePayoutRequestDto {
  /** Запрашиваемая сумма выплаты в рублях. Должна быть > 0. */
  @IsNumber()
  @Min(0.01)
  amount: number;

  /** Реквизиты для перевода (карта/кошелёк/IBAN/и т.п.). */
  @IsString()
  @MinLength(5)
  @MaxLength(2000)
  requisites: string;
}
