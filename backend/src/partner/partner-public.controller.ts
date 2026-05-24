import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { Request, Response } from 'express';

import { PartnerApplicationService } from './partner-application.service';
import { PartnerAuthService } from './partner-auth.service';
import { CreateApplicationDto } from './dto/create-application.dto';
import { PartnerLoginDto } from './dto/partner-login.dto';
import { SetPasswordDto } from './dto/set-password.dto';

/** Cookie name carrying the partner JWT (mirrors PartnerAuthGuard). */
const PARTNER_TOKEN_COOKIE = 'partner_token';

/** Cookie lifetime — matches the JWT TTL of 24 hours. */
const PARTNER_COOKIE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * PartnerPublicController
 *
 * Public-facing partner endpoints — no authentication required. Owns:
 *   - the application-submission form (Requirement 4.5)
 *   - the cabinet login flow (Requirement 11.1, 11.3–11.6)
 *   - the invite-link set-password flow (Requirement 11.2)
 *   - logout (clears the session cookie)
 *
 * Cookie strategy: on successful login we set an `httpOnly`,
 * `sameSite=strict`, `secure` (in production) cookie that
 * {@link PartnerAuthGuard} reads on subsequent cabinet requests. We
 * also return the raw token in the response body so non-browser
 * clients (curl, scripts) can pull it out of `data.token`. Browsers
 * that store the cookie can ignore the body token entirely.
 *
 * `@Res({ passthrough: true })` keeps Nest's normal "return-value
 * → JSON" pipeline intact while still letting us call
 * `res.cookie(...)` / `res.clearCookie(...)` directly. Without
 * passthrough the framework would expect us to manage the response
 * lifecycle by hand, which would force every endpoint into
 * `res.json(...)` calls — a regression from the rest of the codebase.
 */
@Controller('partner')
export class PartnerPublicController {
  constructor(
    private readonly applicationService: PartnerApplicationService,
    private readonly authService: PartnerAuthService,
  ) {}

  // ─── applications ────────────────────────────────────────────────────

  /**
   * POST /api/partner/applications
   *
   * Accepts a partner-program application from the public landing page
   * and stores it as `pending` for admin review. Returns the new
   * application id so the frontend can show a confirmation screen with
   * a reference number.
   */
  @Post('applications')
  @HttpCode(HttpStatus.CREATED)
  async submitApplication(@Body() dto: CreateApplicationDto) {
    const application = await this.applicationService.submit(dto);
    return {
      success: true,
      data: { id: application.id },
    };
  }

  // ─── auth: login ─────────────────────────────────────────────────────

  /**
   * POST /api/partner/auth/login
   *
   * Authenticates a partner with username + password. On success:
   *   - sets the `partner_token` cookie so subsequent browser
   *     navigation to `/api/partner/*` sends the JWT automatically;
   *   - returns the token + minimal partner info in the JSON body for
   *     non-cookie clients.
   *
   * On failure {@link PartnerAuthService.login} throws
   * `UnauthorizedException`, which Nest's default exception filter
   * surfaces as 401 with the Russian message from the service
   * (`Неверный логин или пароль` / `Учётная запись отключена`).
   */
  @Post('auth/login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: PartnerLoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ip = req.ip || req.socket?.remoteAddress;
    const result = await this.authService.login(dto.username, dto.password, ip);

    res.cookie(PARTNER_TOKEN_COOKIE, result.token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      maxAge: PARTNER_COOKIE_MAX_AGE_MS,
      path: '/',
    });

    return {
      success: true,
      data: {
        token: result.token,
        partner: result.partner,
      },
    };
  }

  // ─── auth: invite-link flow ─────────────────────────────────────────

  /**
   * GET /api/partner/auth/invite-info?token=…
   *
   * Pre-flight call from the invite-link page: validates the token and
   * returns the minimal partner fields the set-password form needs to
   * render (display name + username). Throws `BadRequestException` for
   * any invalid/expired/used token; the frontend renders the message
   * directly.
   */
  @Get('auth/invite-info')
  async getInviteInfo(@Query('token') token: string) {
    const info = await this.authService.getInviteInfo(token ?? '');
    return {
      success: true,
      data: info,
    };
  }

  /**
   * POST /api/partner/auth/set-password
   *
   * Consumes an invite token and writes the partner's chosen password.
   * Returns the partner id so the frontend can immediately redirect to
   * `/partner/login` with a "set password OK — sign in now" hint
   * (Requirement 11.2).
   */
  @Post('auth/set-password')
  @HttpCode(HttpStatus.OK)
  async setPassword(@Body() dto: SetPasswordDto) {
    const result = await this.authService.setPasswordViaInvite(
      dto.token,
      dto.password,
    );
    return {
      success: true,
      data: result,
    };
  }

  // ─── auth: logout ───────────────────────────────────────────────────

  /**
   * POST /api/partner/auth/logout
   *
   * Clears the `partner_token` cookie. The JWT itself remains valid
   * until expiry — we don't maintain a server-side revocation list —
   * but a clean cookie wipe is enough for the cabinet UI to behave as
   * "logged out". Public endpoint by design: even an unauthenticated
   * call is a safe no-op.
   */
  @Post('auth/logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(PARTNER_TOKEN_COOKIE, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    });
    return { success: true };
  }
}
