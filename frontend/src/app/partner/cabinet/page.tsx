'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import CabinetNav from './CabinetNav';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

/**
 * Partner cabinet dashboard (`/partner/cabinet`).
 *
 * Fetches `/api/partner/dashboard` once on mount and renders four
 * balance cards plus a promo-code panel and a rates panel — that's
 * all Requirement 12.1 calls for. Auth is handled at two layers:
 *   - Server-side `cabinet/layout.tsx` redirects unauthenticated
 *     visitors before this page ever runs (cookie absent → 302).
 *   - Client-side fallback: a 401 response (cookie present but
 *     expired between server check and this fetch) triggers an
 *     immediate `router.push('/partner/login')` so the partner is
 *     never stuck on a broken page.
 *
 * Data is fetched with `credentials: 'include'` because the JWT
 * lives in the httpOnly `partner_token` cookie — see
 * `PartnerCabinetController` and `PartnerAuthGuard`.
 */

interface DashboardData {
  partnerBalance: number;
  pendingBalance: number;
  totalEarned: number;
  totalPaid: number;
  currentPromoCode: string | null;
  discountRate: number;
  commissionRate: number;
  displayName: string;
  username: string;
  status: 'active' | 'disabled';
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: DashboardData };

/** Russian-formatting helpers shared with the other cabinet pages. */
const ruMoney = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'RUB',
  maximumFractionDigits: 2,
});
const formatMoney = (value: number) => ruMoney.format(value || 0);
const formatPercent = (rate: number) => `${(Number(rate) * 100).toFixed(2)}%`;

export default function PartnerDashboardPage() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [copied, setCopied] = useState(false);

  const loadDashboard = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/partner/dashboard`, {
        method: 'GET',
        credentials: 'include',
      });

      if (response.status === 401) {
        router.push('/partner/login');
        return;
      }

      if (!response.ok) {
        setState({
          kind: 'error',
          message:
            'Не удалось загрузить данные кабинета. Попробуйте обновить страницу.',
        });
        return;
      }

      const body = await response.json();
      const data = body?.data as DashboardData | undefined;
      if (!data) {
        setState({
          kind: 'error',
          message: 'Получен некорректный ответ от сервера.',
        });
        return;
      }

      setState({ kind: 'ready', data });
    } catch {
      setState({
        kind: 'error',
        message:
          'Не удалось загрузить данные кабинета. Проверьте подключение к интернету.',
      });
    }
  }, [router]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  // ── promo-code copy ─────────────────────────────────────────────────
  const handleCopy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Some browsers refuse clipboard.writeText without a secure
      // context — fail silently rather than alert; the partner can
      // select-and-copy manually as a fallback.
    }
  };

  return (
    <main
      className="relative min-h-screen overflow-x-hidden bg-[#050507] text-[#f7f5ff]"
      style={{
        fontFamily:
          'var(--font-manrope), var(--font-inter), system-ui, sans-serif',
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0"
        style={{
          background:
            'radial-gradient(circle at 50% 8%, rgba(143,92,255,0.18), transparent 36%), radial-gradient(circle at 82% 42%, rgba(39,232,244,0.07), transparent 30%), linear-gradient(180deg, #07070a 0%, #050507 52%, #08070c 100%)',
        }}
      />

      <div className="relative z-10 mx-auto w-[min(1080px,calc(100%-32px))] px-0 py-8 md:py-10">
        <CabinetNav
          displayName={state.kind === 'ready' ? state.data.displayName : undefined}
          username={state.kind === 'ready' ? state.data.username : undefined}
        />

        {state.kind === 'loading' && <DashboardSkeleton />}

        {state.kind === 'error' && (
          <div
            role="alert"
            className="mt-8 rounded-2xl border border-[rgba(239,68,68,.32)] bg-[rgba(239,68,68,.08)] p-5 text-sm text-[#fecaca]"
          >
            {state.message}
            <button
              type="button"
              onClick={() => {
                setState({ kind: 'loading' });
                loadDashboard();
              }}
              className="ml-3 inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/[.04] px-3 py-1.5 text-xs font-semibold text-[#f7f5ff] hover:bg-white/[.08]"
            >
              Повторить
            </button>
          </div>
        )}

        {state.kind === 'ready' && (
          <div className="mt-8 space-y-6">
            <StatusBadge status={state.data.status} />

            {/* stat cards */}
            <section
              aria-label="Баланс и статистика"
              className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
            >
              <StatCard
                label="Доступно к выплате"
                value={formatMoney(state.data.partnerBalance)}
                accent
              />
              <StatCard
                label="На рассмотрении"
                value={formatMoney(state.data.pendingBalance)}
                hint="Комиссии по pending заказам"
              />
              <StatCard
                label="Всего заработано"
                value={formatMoney(state.data.totalEarned)}
              />
              <StatCard
                label="Всего выплачено"
                value={formatMoney(state.data.totalPaid)}
              />
            </section>

            {/* promo code + rates panels */}
            <section className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
              <PromoCodePanel
                code={state.data.currentPromoCode}
                copied={copied}
                onCopy={handleCopy}
              />
              <RatesPanel
                discountRate={state.data.discountRate}
                commissionRate={state.data.commissionRate}
              />
            </section>
          </div>
        )}
      </div>
    </main>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Subcomponents
// ────────────────────────────────────────────────────────────────────────

function DashboardSkeleton() {
  return (
    <div className="mt-8 space-y-6" aria-hidden>
      <div className="h-10 w-40 rounded-full bg-white/[.04]" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-[120px] rounded-3xl border border-white/[.07] bg-white/[.02]"
          />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="h-[160px] rounded-3xl border border-white/[.07] bg-white/[.02]" />
        <div className="h-[160px] rounded-3xl border border-white/[.07] bg-white/[.02]" />
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: 'active' | 'disabled' }) {
  const isActive = status === 'active';
  return (
    <div className="flex items-center gap-2">
      <span
        className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-extrabold"
        style={
          isActive
            ? {
                borderColor: 'rgba(65,229,157,.32)',
                background: 'rgba(65,229,157,.10)',
                color: '#41e59d',
              }
            : {
                borderColor: 'rgba(239,68,68,.32)',
                background: 'rgba(239,68,68,.08)',
                color: '#fca5a5',
              }
        }
      >
        <span
          aria-hidden
          className="h-1.5 w-1.5 rounded-full"
          style={{
            background: isActive ? '#41e59d' : '#ef4444',
            boxShadow: isActive
              ? '0 0 10px rgba(65,229,157,.9)'
              : '0 0 10px rgba(239,68,68,.7)',
          }}
        />
        {isActive ? 'Активен' : 'Отключён'}
      </span>
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
}

function StatCard({ label, value, hint, accent }: StatCardProps) {
  return (
    <div
      className="rounded-3xl border bg-white/[.025] p-5 transition-colors"
      style={{
        borderColor: accent
          ? 'rgba(143,92,255,.28)'
          : 'rgba(255,255,255,.06)',
        background: accent
          ? 'linear-gradient(160deg, rgba(143,92,255,.10), rgba(143,92,255,.02))'
          : undefined,
      }}
    >
      <div className="text-[11px] font-semibold uppercase tracking-[.12em] text-[#aaa5b9]">
        {label}
      </div>
      <div
        className="mt-3 text-[clamp(22px,3vw,28px)] font-extrabold tracking-[-.02em] tabular-nums text-[#f7f5ff]"
        style={{ fontFamily: 'var(--font-manrope), system-ui, sans-serif' }}
      >
        {value}
      </div>
      {hint ? (
        <div className="mt-2 text-xs leading-[1.5] text-[#706b80]">{hint}</div>
      ) : null}
    </div>
  );
}

interface PromoCodePanelProps {
  code: string | null;
  copied: boolean;
  onCopy: (code: string) => void;
}

function PromoCodePanel({ code, copied, onCopy }: PromoCodePanelProps) {
  const hasCode = Boolean(code);
  return (
    <div className="rounded-3xl border border-white/10 bg-white/[.025] p-6">
      <div className="text-[11px] font-semibold uppercase tracking-[.12em] text-[#aaa5b9]">
        Ваш промокод
      </div>
      <p className="mt-2 text-xs leading-[1.6] text-[#706b80]">
        Делитесь этим кодом со своей аудиторией. Покупатели вводят его на
        оформлении заказа и получают скидку, вы — комиссию.
      </p>

      {hasCode ? (
        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            type="text"
            readOnly
            value={code ?? ''}
            aria-label="Промокод партнёра"
            onClick={(e) => (e.currentTarget as HTMLInputElement).select()}
            className="flex-1 rounded-2xl border border-white/10 bg-white/[.04] px-4 py-3 text-base font-bold tracking-[.18em] text-[#f7f5ff] outline-none focus:bg-white/[.06]"
            style={{
              fontFamily: 'var(--font-jetbrains-mono), ui-monospace, monospace',
            }}
          />
          <button
            type="button"
            onClick={() => code && onCopy(code)}
            aria-live="polite"
            className="inline-flex items-center justify-center rounded-2xl px-5 py-3 text-sm font-extrabold text-[#fbfaff] transition-transform hover:-translate-y-0.5"
            style={{
              background: copied
                ? 'linear-gradient(135deg, #41e59d, #22c55e)'
                : 'linear-gradient(135deg, #8f5cff, #6d42e8)',
              boxShadow: copied
                ? '0 0 24px rgba(65,229,157,.32)'
                : '0 0 24px rgba(143,92,255,.32)',
            }}
          >
            {copied ? 'Скопировано' : 'Скопировать'}
          </button>
        </div>
      ) : (
        <div className="mt-5 rounded-2xl border border-white/[.07] bg-white/[.02] p-4 text-sm text-[#aaa5b9]">
          Промокод ещё не назначен. Свяжитесь с менеджером, чтобы его выпустили.
        </div>
      )}
    </div>
  );
}

interface RatesPanelProps {
  discountRate: number;
  commissionRate: number;
}

function RatesPanel({ discountRate, commissionRate }: RatesPanelProps) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/[.025] p-6">
      <div className="text-[11px] font-semibold uppercase tracking-[.12em] text-[#aaa5b9]">
        Текущие условия
      </div>
      <div className="mt-4 space-y-4">
        <RateRow
          label="Скидка покупателю"
          hint="Размер скидки, который применяется к заказу при вводе вашего промокода."
          value={formatPercent(discountRate)}
        />
        <RateRow
          label="Ваша комиссия"
          hint="Процент от суммы успешно выполненного заказа, который начисляется на ваш баланс."
          value={formatPercent(commissionRate)}
        />
      </div>
    </div>
  );
}

function RateRow({
  label,
  hint,
  value,
}: {
  label: string;
  hint: string;
  value: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-2xl border border-white/[.07] bg-white/[.02] p-4">
      <div className="min-w-0">
        <div className="text-sm font-extrabold text-[#f7f5ff]">{label}</div>
        <div className="mt-1 text-xs leading-[1.5] text-[#706b80]">{hint}</div>
      </div>
      <div
        className="shrink-0 text-2xl font-extrabold tabular-nums text-[#b79dff]"
        style={{ textShadow: '0 0 24px rgba(143,92,255,.36)' }}
      >
        {value}
      </div>
    </div>
  );
}
