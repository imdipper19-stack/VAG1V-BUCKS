import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
} from '@nestjs/common';

/**
 * Простой rate limiter на основе in-memory map
 * Ограничивает количество запросов с одного IP
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly requests = new Map<string, { count: number; resetAt: number }>();
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(maxRequests = 100, windowMs = 60000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;

    // Очистка старых записей каждые 5 минут
    setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const ip = request.ip || request.socket?.remoteAddress || 'unknown';
    const now = Date.now();

    const entry = this.requests.get(ip);

    if (!entry || now > entry.resetAt) {
      // Новый window
      this.requests.set(ip, { count: 1, resetAt: now + this.windowMs });
      return true;
    }

    entry.count += 1;

    if (entry.count > this.maxRequests) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: `Too many requests. Try again in ${retryAfter} seconds.`,
          retryAfter,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  private cleanup() {
    const now = Date.now();
    for (const [ip, entry] of this.requests.entries()) {
      if (now > entry.resetAt) {
        this.requests.delete(ip);
      }
    }
  }
}

/**
 * Строгий rate limiter для auth endpoints (5 попыток в минуту)
 */
@Injectable()
export class AuthRateLimitGuard extends RateLimitGuard {
  constructor() {
    super(5, 60000); // 5 requests per minute
  }
}

/**
 * Средний rate limiter для обычных API (60 запросов в минуту)
 */
@Injectable()
export class ApiRateLimitGuard extends RateLimitGuard {
  constructor() {
    super(60, 60000); // 60 requests per minute
  }
}
