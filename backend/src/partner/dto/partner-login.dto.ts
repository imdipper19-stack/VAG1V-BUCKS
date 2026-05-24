import { IsString, MinLength } from 'class-validator';

/**
 * Payload for `POST /api/partner/auth/login` (Requirement 11.1, 11.4).
 *
 * Validation here is intentionally loose:
 *   - `username`: at least 3 characters, matching the partner-username
 *     shape constraints already enforced at creation time
 *     (`/^[a-zA-Z0-9_-]{3,64}$/`). We don't repeat the regex here so a
 *     legacy username with grandfathered formatting can still attempt
 *     login; the auth service treats unknown usernames the same as
 *     wrong passwords (`Неверный логин или пароль`) anyway.
 *   - `password`: at least 1 character, just enough to ensure the body
 *     was sent. The minimum-length policy (8 chars) is only relevant on
 *     `set-password`; existing partners with short legacy passwords —
 *     should they exist — would be locked out otherwise.
 *
 * The endpoint deliberately does not leak which field was wrong.
 */
export class PartnerLoginDto {
  @IsString()
  @MinLength(3)
  username: string;

  @IsString()
  @MinLength(1)
  password: string;
}
