import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { PartnerAuthService } from '../partner-auth.service';

/** Cookie name carrying the partner JWT (httpOnly in prod). */
const PARTNER_TOKEN_COOKIE = 'partner_token';

/**
 * PartnerAuthGuard
 *
 * Protects partner-cabinet routes. Extracts the JWT from either the
 * `partner_token` cookie or an `Authorization: Bearer <token>` header,
 * delegates verification to {@link PartnerAuthService.validateToken}
 * (which also enforces `role === 'partner'` and `status === 'active'`),
 * and attaches the resolved partner to the request as `request.partner`
 * for the {@link CurrentPartner} param decorator to read.
 *
 * The cookie is checked first so browser-driven cabinet pages don't
 * need to manually attach the Authorization header. The header path is
 * kept for non-browser clients (curl, scripts, future API access).
 *
 * NOTE: cookie parsing is done by hand here because the project does
 * not register `cookie-parser` middleware in `main.ts`. Reading
 * `request.headers.cookie` directly avoids a new dependency.
 */
@Injectable()
export class PartnerAuthGuard implements CanActivate {
  constructor(private readonly partnerAuthService: PartnerAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException('No token provided');
    }

    const partner = await this.partnerAuthService.validateToken(token);
    if (!partner) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    // The CurrentPartner decorator reads this property.
    (request as Request & { partner?: unknown }).partner = partner;
    return true;
  }

  /**
   * Resolves the JWT for the request. Cookie wins over Authorization
   * header so a logged-in browser session is preferred even if a stale
   * Authorization header happens to be attached by tooling.
   */
  private extractToken(request: Request): string | null {
    return (
      this.extractFromCookie(request, PARTNER_TOKEN_COOKIE) ??
      this.extractFromAuthHeader(request)
    );
  }

  /**
   * Returns the value of the named cookie. Uses
   * `request.cookies?.[name]` if cookie-parser is registered (future-
   * proof — the property is `undefined` today, but harmless), otherwise
   * falls back to a manual parse of the raw `Cookie` header.
   *
   * The manual parser is intentionally minimal: split on `;`, split
   * each pair on the first `=`, decodeURIComponent the value. We do
   * not handle quoted-string semantics from RFC 6265 §4.1.1 because
   * the partner token is opaque base64url that never needs quoting.
   */
  private extractFromCookie(request: Request, name: string): string | null {
    const parsed = (request as Request & { cookies?: Record<string, string> })
      .cookies?.[name];
    if (typeof parsed === 'string' && parsed.length > 0) return parsed;

    const raw = request.headers.cookie;
    if (!raw) return null;

    for (const pair of raw.split(';')) {
      const eq = pair.indexOf('=');
      if (eq === -1) continue;
      const key = pair.slice(0, eq).trim();
      if (key !== name) continue;
      const value = pair.slice(eq + 1).trim();
      if (!value) return null;
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    }
    return null;
  }

  /** Parses `Authorization: Bearer <token>`, or `null` if absent/malformed. */
  private extractFromAuthHeader(request: Request): string | null {
    const header = request.headers.authorization;
    if (!header) return null;
    const [type, token] = header.split(' ');
    if (type !== 'Bearer' || !token) return null;
    return token;
  }
}
