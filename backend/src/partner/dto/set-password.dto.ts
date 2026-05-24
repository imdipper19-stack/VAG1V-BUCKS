import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * Payload for `POST /api/partner/auth/set-password` — invite-link
 * password setter (Requirement 11.2).
 *
 * `token` must be the 64-char hex string produced by
 * {@link PartnerAuthService.generateInviteToken} (32 bytes →
 * 64 hex chars). We refuse anything else at the DTO layer so a junk
 * value never reaches the DB lookup.
 *
 * `password` length window:
 *   - lower bound 8: matches `MIN_PASSWORD_LENGTH` enforced inside
 *     {@link PartnerAuthService.setPasswordViaInvite}; the DTO mirror
 *     surfaces the validation error before hitting the service.
 *   - upper bound 256: defensive guard. scrypt has no practical upper
 *     limit, but a multi-MB password would just waste CPU.
 */
export class SetPasswordDto {
  @IsString()
  @Matches(/^[0-9a-f]{64}$/, {
    message: 'Token must be 64 hexadecimal characters',
  })
  token: string;

  @IsString()
  @MinLength(8)
  @MaxLength(256)
  password: string;
}
