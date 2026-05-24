import {
  IsEnum,
  IsNotEmpty,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

import { PartnerApplicationPlatformType } from '../entities/partner-application.entity';

/**
 * Payload for `POST /api/partner/applications`.
 *
 * Validation reflects Requirement 4.2–4.4:
 *   - all visible form fields are required and length-bounded;
 *   - `platformUrl` must be an absolute http/https URL;
 *   - `contactTg` must look like a Telegram username (`@` + 4–32 chars
 *     of `[A-Za-z0-9_]`).
 *
 * Field max lengths mirror the underlying `partner_applications` table
 * column widths (see migration `1735000000000-AddPartnerTables` and
 * `partner-application.entity.ts`) so a request that passes validation
 * is guaranteed to fit on insert.
 */
export class CreateApplicationDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(128)
  displayName: string;

  @IsEnum(PartnerApplicationPlatformType)
  platformType: PartnerApplicationPlatformType;

  @IsUrl(
    { require_protocol: true, protocols: ['http', 'https'] },
    { message: 'URL должен начинаться с http:// или https://' },
  )
  @MaxLength(512)
  platformUrl: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  audienceSize: string;

  @Matches(/^@[A-Za-z0-9_]{4,32}$/, {
    message:
      'Контакт TG должен начинаться с @ и содержать 4-32 латинских символа/цифры/_',
  })
  contactTg: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  @MaxLength(2000)
  description: string;
}
