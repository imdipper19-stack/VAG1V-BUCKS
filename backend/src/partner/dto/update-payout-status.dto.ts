import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

import { PayoutRequestStatus } from '../entities/payout-request.entity';

/**
 * Payload for `PATCH /api/admin/payouts/:id/status` — admin transition
 * of a Payout_Request between states (Requirement 14.3–14.5).
 *
 * Allowed `status` values are validated against the
 * {@link PayoutRequestStatus} enum at the DTO layer; the actual
 * transition graph (`requested → processing → paid`,
 * `requested|processing → rejected`) is enforced at the service layer
 * because it depends on the stored row's current state.
 *
 * `rejectionReason` is optional and is consumed only when
 * `status === 'rejected'` (Requirement 14.5). For other transitions
 * the service silently ignores any value passed here.
 */
export class UpdatePayoutStatusDto {
  /** Целевой Payout_Status. */
  @IsEnum(PayoutRequestStatus)
  status: PayoutRequestStatus;

  /**
   * Причина отказа. Используется только при `status === 'rejected'`,
   * для остальных переходов игнорируется.
   */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  rejectionReason?: string;
}
