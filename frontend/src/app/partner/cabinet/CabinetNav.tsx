'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

/**
 * Navigation strip shared by every `/partner/cabinet/*` page.
 *
 * Renders three pill-style tabs (dashboard, orders, payouts), the
 * partner's identity block (display name + `@username`), and the
 * logout button. Highlighted tab is computed from `usePathname()` so
 * the same component works on every cabinet route without props.
 *
 * Logout flow:
 *   1. POST /api/partner/auth/logout — backend clears the httpOnly
 *      `partner_token` cookie. We don't need the response body; the
 *      cookie wipe is the only state we care about.
 *   2. router.push('/partner/login') + router.refresh() — push so the
 *      browser leaves the protected layout immediately, refresh so
 *      the next render of the cabinet layout (if the user navigates
 *      back) actually re-reads the now-absent cookie on the server
 *      and redirects to login.
 *   3. Even if the API call fails (offline, server down) we still
 *      redirect — leaving the user staring at a stale cabinet would
 *      be worse than over-redirecting.
 *
 * The component is self-contained: each cabinet page passes the
 * `displayName` / `username` it already loaded from
 * `/api/partner/dashboard`, so this file does NOT issue its own
 * dashboard fetch. That keeps render order deterministic and avoids
 * a second redundant request per page.
 */
export default function CabinetNav({
  displayName,
  username,
}: {
  displayName?: string;
  username?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  const tabs = [
    { href: '/partner/cabinet', label: 'Дашборд' },
    { href: '/partner/cabinet/orders', label: 'История заказов' },
    { href: '/partner/cabinet/payouts', label: 'Выплаты' },
  ] as const;

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await fetch(`${API_URL}/partner/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch {
      // Network error — still proceed with redirect; cookie may
      // still be set, but the cabinet layout will redirect on the
      // next protected request anyway.
    }
    router.push('/partner/login');
    router.refresh();
  };

  return (
    <header className="rounded-[28px] border border-white/10 bg-white/[.025] p-4 md:p-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        {/* identity */}
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-2xl text-base font-extrabold text-[#fbfaff]"
            style={{
              background: 'linear-gradient(135deg, #8f5cff, #6d42e8)',
              boxShadow: '0 0 24px rgba(143,92,255,.34)',
            }}
          >
            {(displayName ?? username ?? '?').slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-[.12em] text-[#706b80]">
              Кабинет партнёра
            </div>
            <div className="truncate text-sm font-extrabold text-[#f7f5ff]">
              {displayName ?? '—'}
              {username ? (
                <span className="ml-2 font-normal text-[#aaa5b9]">
                  @{username}
                </span>
              ) : null}
            </div>
          </div>
        </div>

        {/* tabs + logout */}
        <div className="flex flex-wrap items-center gap-2">
          <nav className="flex flex-wrap gap-1.5 rounded-2xl border border-white/[.07] bg-white/[.02] p-1.5">
            {tabs.map((t) => {
              const active = pathname === t.href;
              return (
                <Link
                  key={t.href}
                  href={t.href}
                  aria-current={active ? 'page' : undefined}
                  className={
                    active
                      ? 'inline-flex items-center justify-center rounded-xl px-4 py-2 text-xs font-extrabold text-[#fbfaff]'
                      : 'inline-flex items-center justify-center rounded-xl px-4 py-2 text-xs font-semibold text-[#cbc6d6] transition-colors hover:text-[#f7f5ff]'
                  }
                  style={
                    active
                      ? {
                          background:
                            'linear-gradient(135deg, #8f5cff, #6d42e8)',
                          boxShadow: '0 0 24px rgba(143,92,255,.32)',
                        }
                      : undefined
                  }
                >
                  {t.label}
                </Link>
              );
            })}
          </nav>

          <button
            type="button"
            onClick={handleLogout}
            disabled={loggingOut}
            className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-white/[.04] px-4 py-2.5 text-xs font-semibold text-[#cbc6d6] transition-colors hover:text-[#f7f5ff] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loggingOut ? 'Выходим…' : 'Выйти'}
          </button>
        </div>
      </div>
    </header>
  );
}
