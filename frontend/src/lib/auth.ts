/**
 * Утилиты для работы с админ-сессией.
 *
 * Хранение токена в двух местах:
 * 1. localStorage — для axios interceptor (отправка как Bearer header).
 * 2. cookie `admin_token` — для middleware.ts чтобы блокировать SSR-маршруты до логина.
 *
 * Cookie не HttpOnly, потому что нам нужен доступ из JS (для axios). Это даёт
 * защиту от прямого открытия URL, но НЕ от XSS — реальную защиту обеспечивает
 * валидация JWT на бэкенде (AdminAuthGuard).
 */

const TOKEN_KEY = 'admin_token';
const USER_KEY = 'admin_user';
const COOKIE_MAX_AGE_SECONDS = 24 * 60 * 60; // 24h — совпадает с JWT_EXPIRES_IN

export interface AdminUser {
  id: string;
  username: string;
  email: string;
  role: string;
}

function setCookie(name: string, value: string, maxAgeSeconds: number): void {
  if (typeof document === 'undefined') return;
  const secure = typeof window !== 'undefined' && window.location.protocol === 'https:';
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    `Max-Age=${maxAgeSeconds}`,
    'SameSite=Lax',
  ];
  if (secure) parts.push('Secure');
  document.cookie = parts.join('; ');
}

function deleteCookie(name: string): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
}

export function saveAdminSession(token: string, user: AdminUser): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  setCookie(TOKEN_KEY, token, COOKIE_MAX_AGE_SECONDS);
}

export function clearAdminSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  deleteCookie(TOKEN_KEY);
}

export function getAdminToken(): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function getAdminUser(): AdminUser | null {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AdminUser;
  } catch {
    return null;
  }
}
