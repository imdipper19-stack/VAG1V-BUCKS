'use client';

/**
 * Global Header rendered by `app/layout.tsx` on every public page.
 *
 * Note: this replaces the bespoke `<nav className="landing-nav">` that lived
 * inline in `app/page.tsx`. The landing page had a custom navigation styled to
 * match the `landing-shell` aesthetic (rounded pill, anchor links to in-page
 * sections). For the partner-program rollout we trade that bespoke look for a
 * consistent global header that works on every route (landing, oferta,
 * privacy, partner cabinet, etc.). The legacy `.landing-nav` CSS rules in
 * `page.tsx` remain in place but are no longer referenced — they can be
 * cleaned up in a future task.
 */

import Link from 'next/link';
import VbucksIcon from '@/components/ui/VbucksIcon';

const TELEGRAM_CHANNEL_URL = 'https://t.me/FortnitebucksShop';

function TelegramIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z" />
    </svg>
  );
}

export default function Header() {
  return (
    <header
      className="
        sticky top-0 z-40 w-full
        border-b border-white/5
        bg-[rgba(10,10,15,0.72)] backdrop-blur-xl
        supports-[backdrop-filter]:bg-[rgba(10,10,15,0.55)]
      "
    >
      <div className="mx-auto flex w-[min(1180px,calc(100%-32px))] items-center justify-between gap-4 py-3">
        <Link
          href="/"
          aria-label="Bag1V-Bucks"
          className="flex items-center gap-2 text-[14px] font-extrabold tracking-[-0.02em] text-[#f7f5ff] no-underline"
        >
          <span className="grid h-6 w-6 place-items-center rounded-full bg-gradient-to-br from-[#8f5cff] to-[#6d42e8] shadow-[0_0_24px_rgba(143,92,255,0.42)]">
            <VbucksIcon size={16} />
          </span>
          Bag1V-Bucks
        </Link>

        <nav className="flex items-center gap-2 sm:gap-3">
          <a
            href={TELEGRAM_CHANNEL_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Telegram-канал"
            title="Telegram-канал"
            className="
              inline-flex items-center gap-2 rounded-full
              border border-white/10 bg-white/[0.03]
              px-3 py-2 text-[12px] font-semibold text-[#cbc6d6]
              transition-colors hover:text-[#f7f5ff] hover:bg-white/[0.06]
            "
          >
            <TelegramIcon />
            <span className="hidden sm:inline">Telegram</span>
          </a>

          <Link
            href="/partner"
            className="
              inline-flex items-center justify-center rounded-full
              border border-[rgba(143,92,255,0.32)] bg-[rgba(143,92,255,0.12)]
              px-3 sm:px-4 py-2 text-[12px] font-extrabold text-[#ddcffd]
              transition-colors hover:bg-[rgba(143,92,255,0.22)] hover:text-[#f7f5ff]
            "
          >
            Стать партнёром
          </Link>

          <Link
            href="/admin/login"
            className="
              inline-flex items-center justify-center rounded-full
              bg-gradient-to-br from-[#8f5cff] to-[#6d42e8]
              px-3 sm:px-4 py-2 text-[12px] font-extrabold text-[#fbfaff]
              shadow-[0_0_28px_rgba(143,92,255,0.34)]
              transition-transform hover:-translate-y-[1px]
            "
          >
            Войти
          </Link>
        </nav>
      </div>
    </header>
  );
}
