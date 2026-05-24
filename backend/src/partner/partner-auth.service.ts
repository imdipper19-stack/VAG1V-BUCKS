import {
  Injectable,
  Logger,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'node:crypto';

import { Partner, PartnerStatusEnum } from './entities/partner.entity';

/**
 * Shape of the JWT payload issued to a partner. Mirrors
 * `AdminAuthService.TokenPayload` but with `role` pinned to the literal
 * `'partner'` so callers/guards can statically distinguish partner
 * tokens from admin tokens.
 *
 * NOTE: `role` is left as `string` on the verified-payload return type
 * so the verification path can return whatever value the bytes contain
 * (we then reject mismatches in {@link PartnerAuthService.verifyJwt}).
 */
export interface PartnerTokenPayload {
  sub: string;
  username: string;
  role: string;
  iat: number;
  exp: number;
}

export interface PartnerLoginResult {
  token: string;
  partner: {
    id: string;
    username: string;
    displayName: string;
  };
}

export interface PartnerInviteInfo {
  partnerId: string;
  displayName: string;
  username: string;
}

/** Hard-coded role value embedded in every issued partner JWT. */
const PARTNER_ROLE = 'partner';

/** Invite-link lifetime — 72 hours per design.md §2.2. */
const INVITE_TOKEN_TTL_MS = 72 * 60 * 60 * 1000;

/** Default JWT lifetime if `JWT_EXPIRES_IN` env var is missing/invalid. */
const DEFAULT_JWT_TTL_MS = 24 * 60 * 60 * 1000;

/** Minimum partner password length enforced on invite-flow set-password. */
const MIN_PASSWORD_LENGTH = 8;

/**
 * PartnerAuthService
 *
 * Owns the partner-side authentication primitives:
 *
 *   - {@link hashPassword} / {@link verifyPassword} — scrypt with a
 *     `salt:hash` (hex) layout, identical to `AdminAuthService` so a
 *     single password-hashing convention is used across the codebase
 *     and we avoid pulling in a native `bcrypt` dependency
 *     (Requirement 11.5 explicitly permits scrypt).
 *
 *   - {@link generateInviteToken} / {@link getInviteInfo} /
 *     {@link setPasswordViaInvite} — invite-link flow described in
 *     design.md §2.2: an admin generates a one-shot token, ships the
 *     `/partner/invite?token=…` URL to the partner via Telegram, and
 *     the partner picks their own password. Tokens expire after 72h
 *     and are single-use.
 *
 *   - {@link login} / {@link generateJwt} / {@link verifyJwt} /
 *     {@link validateToken} — JWT-based session: the same manual
 *     HS256 / base64url construction used by `AdminAuthService`, just
 *     with `role: 'partner'`. Disabled partners are rejected at login
 *     (Requirement 11.6).
 *
 * The JWT signing path is intentionally a plain `crypto.createHmac`
 * call rather than `@nestjs/jwt` for parity with the admin module —
 * one less dependency, one fewer place to drift.
 */
@Injectable()
export class PartnerAuthService {
  private readonly logger = new Logger(PartnerAuthService.name);
  private readonly jwtSecret: string;
  private readonly jwtTtlMs: number;

  constructor(
    @InjectRepository(Partner)
    private readonly partnerRepo: Repository<Partner>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {
    // We deliberately fall back to a process-local random secret if
    // JWT_SECRET is unset, matching AdminAuthService's behaviour. This
    // means partner tokens become invalid across restarts in dev — an
    // acceptable trade-off for not booting with a known-empty key.
    this.jwtSecret = this.configService.get<string>(
      'JWT_SECRET',
      crypto.randomBytes(32).toString('hex'),
    );
    const expiresIn = this.configService.get<string>('JWT_EXPIRES_IN', '24h');
    this.jwtTtlMs = this.parseExpiresIn(expiresIn);
  }

  // ─── password hashing ────────────────────────────────────────────────

  /**
   * Hashes a password with a fresh 16-byte salt via `scryptSync`.
   * Returns `salt:hash` (both hex). Identical layout to
   * `AdminAuthService.hashPassword` so the two halves of the system
   * share a single password-storage convention.
   */
  hashPassword(password: string): string {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return `${salt}:${hash}`;
  }

  /**
   * Verifies a plain password against a stored `salt:hash` value using
   * a constant-time comparison. Returns `false` for any malformed
   * stored hash rather than throwing — the caller treats false as
   * "invalid credentials".
   */
  verifyPassword(password: string, storedHash: string): boolean {
    if (!storedHash || !storedHash.includes(':')) return false;
    const [salt, hash] = storedHash.split(':');
    if (!salt || !hash) return false;

    const derived = crypto.scryptSync(password, salt, 64).toString('hex');
    const a = Buffer.from(hash, 'hex');
    const b = Buffer.from(derived, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }

  // ─── invite-link flow ────────────────────────────────────────────────

  /**
   * Generates a 64-character hex (256-bit) one-shot invite token for
   * the given partner, persists it on the partner row alongside a
   * 72-hour expiry, and resets `invite_token_used` to false.
   *
   * Trade-off: design.md §2.2 mentions hashing the invite token before
   * storage. We deliberately store the raw token here because (a) the
   * existing admin password-reset code paths follow the same "raw
   * token + short TTL + single-use flag" pattern, and (b) the token
   * never leaves the server in a form anyone but the intended partner
   * can see (it's part of an admin-copied URL that goes via Telegram).
   * If we ever expose a token-listing endpoint or store the token in
   * an audit log, this should be revisited.
   *
   * @returns the raw invite token. The caller (admin controller)
   *   formats the link `/partner/invite?token=<token>`.
   */
  async generateInviteToken(partnerId: string): Promise<string> {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + INVITE_TOKEN_TTL_MS);

    await this.partnerRepo.update(
      { id: partnerId },
      {
        inviteToken: token,
        inviteTokenUsed: false,
        inviteTokenExpiresAt: expiresAt,
      },
    );

    this.logger.log(
      `Generated invite token for partner ${partnerId} ` +
        `(expires ${expiresAt.toISOString()})`,
    );
    return token;
  }

  /**
   * Looks up a partner by invite token and validates that the token is
   * still usable — present, not yet consumed, and not expired. Returns
   * the minimal subset of partner fields the invite UI needs to render
   * the set-password form.
   *
   * @throws BadRequestException with the user-facing Russian message
   *   `Ссылка-приглашение недействительна или истекла` for any failure.
   */
  async getInviteInfo(token: string): Promise<PartnerInviteInfo> {
    const partner = await this.findPartnerByInviteToken(token);
    return {
      partnerId: partner.id,
      displayName: partner.displayName,
      username: partner.username,
    };
  }

  /**
   * Consumes an invite token: re-validates it, hashes the supplied
   * password, writes the password hash, and marks the token used. All
   * three writes happen inside a single DB transaction so a partial
   * failure cannot leave a partner with a fresh hash but still-active
   * invite token (or vice-versa).
   *
   * @throws BadRequestException for invalid/expired tokens or when the
   *   password fails the minimum length check.
   */
  async setPasswordViaInvite(
    token: string,
    password: string,
  ): Promise<{ partnerId: string }> {
    if (!password || password.length < MIN_PASSWORD_LENGTH) {
      throw new BadRequestException(
        `Пароль должен содержать не менее ${MIN_PASSWORD_LENGTH} символов`,
      );
    }

    return this.dataSource.transaction(async (manager) => {
      const partner = await manager.findOne(Partner, {
        where: { inviteToken: token },
      });
      this.assertInviteUsable(partner);

      const passwordHash = this.hashPassword(password);
      await manager.update(
        Partner,
        { id: partner!.id },
        {
          passwordHash,
          inviteTokenUsed: true,
        },
      );

      this.logger.log(`Partner ${partner!.id} set password via invite token`);
      return { partnerId: partner!.id };
    });
  }

  /**
   * Repository-backed partner lookup that throws the public-facing
   * BadRequestException on any kind of invite-token failure. Centralised
   * here so {@link getInviteInfo} and the transactional path inside
   * {@link setPasswordViaInvite} produce identical error responses.
   */
  private async findPartnerByInviteToken(token: string): Promise<Partner> {
    if (!token) {
      throw new BadRequestException(
        'Ссылка-приглашение недействительна или истекла',
      );
    }
    const partner = await this.partnerRepo.findOne({
      where: { inviteToken: token },
    });
    this.assertInviteUsable(partner);
    return partner!;
  }

  /**
   * Throws {@link BadRequestException} unless the partner row carries an
   * unused, unexpired invite token. Designed so callers can safely treat
   * the partner argument as non-null on the happy path.
   */
  private assertInviteUsable(partner: Partner | null): void {
    const reason = (() => {
      if (!partner) return 'partner not found';
      if (partner.inviteTokenUsed) return 'token already used';
      if (
        !partner.inviteTokenExpiresAt ||
        partner.inviteTokenExpiresAt.getTime() < Date.now()
      ) {
        return 'token expired';
      }
      return null;
    })();

    if (reason) {
      this.logger.warn(`Invite token rejected: ${reason}`);
      throw new BadRequestException(
        'Ссылка-приглашение недействительна или истекла',
      );
    }
  }

  // ─── login & JWT ─────────────────────────────────────────────────────

  /**
   * Authenticates a partner by username + password and issues a JWT.
   *
   * Failure modes (Requirement 11.4, 11.6):
   *   - unknown username → `Неверный логин или пароль`
   *   - bad password     → `Неверный логин или пароль`
   *   - status=disabled  → `Учётная запись отключена`
   *
   * The two "bad credentials" branches collapse to the same message so
   * we don't leak which usernames exist.
   */
  async login(
    username: string,
    password: string,
    ip?: string,
  ): Promise<PartnerLoginResult> {
    const partner = await this.partnerRepo.findOne({ where: { username } });
    if (!partner) {
      this.logger.warn(`Partner login failed: user not found - ${username}${ip ? ` from ${ip}` : ''}`);
      throw new UnauthorizedException('Неверный логин или пароль');
    }

    if (!this.verifyPassword(password, partner.passwordHash)) {
      this.logger.warn(`Partner login failed: invalid password - ${username}`);
      throw new UnauthorizedException('Неверный логин или пароль');
    }

    if (partner.status === PartnerStatusEnum.DISABLED) {
      this.logger.warn(`Partner login failed: account disabled - ${username}`);
      throw new UnauthorizedException('Учётная запись отключена');
    }

    const token = this.generateJwt(partner);
    this.logger.log(`Partner logged in: ${username}${ip ? ` from ${ip}` : ''}`);

    return {
      token,
      partner: {
        id: partner.id,
        username: partner.username,
        displayName: partner.displayName,
      },
    };
  }

  /**
   * Builds a signed HS256 JWT for the given partner. The header,
   * payload, and signature are each base64url-encoded; the signature
   * is HMAC-SHA256 over `header.body` keyed by `JWT_SECRET`. Format
   * matches `AdminAuthService.generateToken` byte-for-byte (modulo the
   * `role` field).
   */
  generateJwt(partner: Partner): string {
    const now = Math.floor(Date.now() / 1000);
    const exp = now + Math.floor(this.jwtTtlMs / 1000);

    const payload: PartnerTokenPayload = {
      sub: partner.id,
      username: partner.username,
      role: PARTNER_ROLE,
      iat: now,
      exp,
    };

    const header = this.base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const body = this.base64url(JSON.stringify(payload));

    const signature = crypto
      .createHmac('sha256', this.jwtSecret)
      .update(`${header}.${body}`)
      .digest('base64url');

    return `${header}.${body}.${signature}`;
  }

  /**
   * Decodes and verifies a partner JWT.
   *
   * Returns the parsed payload only when:
   *   1. The token has three dot-separated parts.
   *   2. The signature matches (constant-time compare).
   *   3. The `exp` claim is in the future.
   *   4. The `iat` claim is not implausibly far in the future
   *      (≤ 60 seconds of clock skew allowed).
   *   5. The `role` claim is exactly `'partner'` — this is what
   *      prevents an admin token from sneaking into a partner-only
   *      endpoint and vice-versa.
   *
   * Returns `null` on any other failure; never throws.
   */
  verifyJwt(token: string): PartnerTokenPayload | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      const [header, body, signature] = parts;

      const expected = crypto
        .createHmac('sha256', this.jwtSecret)
        .update(`${header}.${body}`)
        .digest('base64url');

      const sigBuf = Buffer.from(signature);
      const expBuf = Buffer.from(expected);
      if (sigBuf.length !== expBuf.length) return null;
      if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;

      const payload = JSON.parse(
        Buffer.from(body, 'base64url').toString(),
      ) as PartnerTokenPayload;

      const now = Math.floor(Date.now() / 1000);
      if (!payload.exp || payload.exp < now) return null;
      if (payload.iat && payload.iat > now + 60) return null;

      // Cross-role token rejection (Requirement 11; design.md §4):
      // a valid admin signature is still rejected by the partner guard.
      if (payload.role !== PARTNER_ROLE) return null;

      return payload;
    } catch {
      return null;
    }
  }

  /**
   * Guard-friendly token validator. Decodes the JWT, then loads the
   * referenced partner from the DB and confirms they are still
   * `active`. Returns `null` for any failure so the guard can map the
   * single null case to a 401 without translating thrown errors.
   *
   * Disabled-status check on every request means revoking a partner
   * via Admin_Panel takes effect immediately, even for sessions whose
   * JWT has not yet expired.
   */
  async validateToken(token: string): Promise<Partner | null> {
    const payload = this.verifyJwt(token);
    if (!payload) return null;

    const partner = await this.partnerRepo.findOne({
      where: { id: payload.sub },
    });
    if (!partner) return null;
    if (partner.status !== PartnerStatusEnum.ACTIVE) return null;
    return partner;
  }

  // ─── helpers ─────────────────────────────────────────────────────────

  /** Base64url-encodes a UTF-8 string (no padding, URL-safe alphabet). */
  private base64url(str: string): string {
    return Buffer.from(str).toString('base64url');
  }

  /**
   * Parses `JWT_EXPIRES_IN` style strings (`30s`, `15m`, `24h`, `7d`)
   * into milliseconds. Falls back to {@link DEFAULT_JWT_TTL_MS} for
   * malformed input.
   */
  private parseExpiresIn(value: string): number {
    const match = value.match(/^(\d+)(s|m|h|d)$/);
    if (!match) return DEFAULT_JWT_TTL_MS;
    const num = parseInt(match[1], 10);
    switch (match[2]) {
      case 's':
        return num * 1000;
      case 'm':
        return num * 60 * 1000;
      case 'h':
        return num * 60 * 60 * 1000;
      case 'd':
        return num * 24 * 60 * 60 * 1000;
      default:
        return DEFAULT_JWT_TTL_MS;
    }
  }
}
