/**
 * Global Footer rendered by `app/layout.tsx` on every public page.
 *
 * Replaces the inline `<footer className="landing-footer">` previously
 * embedded in `app/page.tsx`. See the note in `Header.tsx` about the legacy
 * `.landing-footer` CSS — it remains in `page.tsx` but is no longer used.
 */

import Link from 'next/link';
import VbucksIcon from '@/components/ui/VbucksIcon';

const TELEGRAM_CHANNEL_URL = 'https://t.me/FortnitebucksShop';
const TELEGRAM_SUPPORT_URL = 'https://t.me/BAG1BAG1';
const DOMAIN = 'bag1v-bucks.shop';

function TelegramIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z" />
    </svg>
  );
}

export default function Footer() {
  return (
    <footer className="relative z-10 mt-12 border-t border-white/5 bg-[rgba(8,7,12,0.6)] py-10">
      <div className="mx-auto grid w-[min(1180px,calc(100%-32px))] gap-8 md:grid-cols-[1fr_1fr_1fr]">
        <div className="flex flex-col gap-3">
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
          <p className="text-[12px] leading-[1.6] text-[#706b80]">
            © 2026 Bag1V-Bucks · {DOMAIN}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <span className="mb-1 text-[10px] font-bold uppercase tracking-[0.08em] text-[#706b80]">
            Документы
          </span>
          <Link href="/oferta" className="text-[13px] text-[#aaa5b9] transition-colors hover:text-[#f7f5ff]">
            Оферта
          </Link>
          <Link href="/privacy" className="text-[13px] text-[#aaa5b9] transition-colors hover:text-[#f7f5ff]">
            Политика конфиденциальности
          </Link>
          <Link href="/cookies" className="text-[13px] text-[#aaa5b9] transition-colors hover:text-[#f7f5ff]">
            Cookie policy
          </Link>
        </div>

        <div className="flex flex-col gap-2">
          <span className="mb-1 text-[10px] font-bold uppercase tracking-[0.08em] text-[#706b80]">
            Связь
          </span>
          <a
            href={TELEGRAM_CHANNEL_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Telegram-канал"
            className="inline-flex items-center gap-2 text-[13px] text-[#aaa5b9] transition-colors hover:text-[#f7f5ff]"
          >
            <TelegramIcon />
            Telegram-канал
          </a>
          <Link
            href="/partner"
            className="text-[13px] text-[#aaa5b9] transition-colors hover:text-[#f7f5ff]"
          >
            Стать партнёром
          </Link>
          <a
            href={TELEGRAM_SUPPORT_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-[13px] text-[#aaa5b9] transition-colors hover:text-[#f7f5ff]"
          >
            <TelegramIcon />
            Поддержка TG
          </a>
        </div>
      </div>
    </footer>
  );
}
