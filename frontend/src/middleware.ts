import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Edge middleware: блокирует прямой доступ к /admin/* без cookie admin_token.
 * Реальная валидация JWT идёт на бэкенде (AdminAuthGuard) при каждом API-запросе.
 * Эта проверка нужна, чтобы анонимы не видели даже UI-обвязку админки.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // /admin/login — публичная, остальные /admin/* — защищённые
  if (pathname.startsWith('/admin') && !pathname.startsWith('/admin/login')) {
    const token = request.cookies.get('admin_token')?.value;

    if (!token) {
      const loginUrl = new URL('/admin/login', request.url);
      loginUrl.searchParams.set('redirect', pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  // Если уже залогинен и идёт на /admin/login — перенаправляем в дашборд
  if (pathname === '/admin/login') {
    const token = request.cookies.get('admin_token')?.value;
    if (token) {
      return NextResponse.redirect(new URL('/admin', request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*'],
};
