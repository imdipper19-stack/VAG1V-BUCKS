'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import CabinetNav from '../CabinetNav';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

/**
 * Partner cabinet — order history (`/partner/cabinet/orders`).
 *
 * Lists every order placed with this partner's promo code, newest
 * first, with the matching commission entry attached
 * (Requirement 12.2–12.3).
 *
 * Pagination is offset-based against `/api/partner/orders?limit=&offset=`,
 * 50 rows per page. The backend returns `total` so we can render
 * "Page X of Y" with next/prev disabled at the edges.
 *
 * Two parallel fetches on mount:
 *   - `/api/partner/dashboard` — to populate the nav header with
 *     displayName/username and identify auth state. We deliberately
 *     refetch instead of plumbing it through query params or context
 *     to keep this page self-contained.
 *   - `/api/partner/orders?limit=50&offset=0` — first page of data.
 *
 * 401 from either call → redirect to `/partner/login` (the cookie
 * has expired between the server-side layout check and this fetch).
 */

const PAGE_SIZE = 50;

interface OrderRow {
  orderId: string;
  createdAt: string;
  priceTRY: number;
  vbucksAmount: number;
  status: string;
  commissionAmount: number | null;
  commissionStatus: 'pending' | 'approved' | 'cancelled' | null;
}

interface OrdersResponse {
  items: OrderRow[];
  total: number;
  limit: number;
  offset: number;
}

interface PartnerIdentity {
  displayName: string;
  username: string;
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: OrdersResponse };

const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
  dateStyle: 'short',
  timeStyle: 'short',
});

const ruMoney = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'RUB',
  maximumFractionDigits: 2,
});
const formatMoney = (value: number | null) =>
  value === null ? '—' : ruMoney.format(value);

const ruVbucks = new Intl.NumberFormat('ru-RU');

export default function PartnerOrdersPage() {
  const router = useRouter();
  const [identity, setIdentity] = useState<PartnerIdentity | null>(null);
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [offset, setOffset] = useState(0);

  const loadOrders = useCallback(
    async (pageOffset: number) => {
      setState({ kind: 'loading' });
      try {
        const response = await fetch(
          `${API_URL}/partner/orders?limit=${PAGE_SIZE}&offset=${pageOffset}`,
          { method: 'GET', credentials: 'include' },
        );

        if (response.status === 401) {
          router.push('/partner/login');
          return;
        }

        if (!response.ok) {
          setState({
            kind: 'error',
            message:
              'Не удалось загрузить историю заказов. Попробуйте обновить страницу.',
          });
          return;
        }

        const body = await response.json();
        const data = body?.data as OrdersResponse | undefined;
        if (!data || !Array.isArray(data.items)) {
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
            'Не удалось загрузить историю заказов. Проверьте подключение к интернету.',
        });
      }
    },
    [router],
  );

  // identity: load once on mount alongside the first page of orders.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`${API_URL}/partner/dashboard`, {
          method: 'GET',
          credentials: 'include',
        });
        if (response.status === 401) {
          if (!cancelled) router.push('/partner/login');
          return;
        }
        if (!response.ok) return;
        const body = await response.json();
        const data = body?.data;
        if (!cancelled && data?.displayName && data?.username) {
          setIdentity({
            displayName: data.displayName,
            username: data.username,
          });
        }
      } catch {
        /* ignore — nav will fall back to defaults */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    loadOrders(offset);
  }, [offset, loadOrders]);

  // ── derived pagination state ───────────────────────────────────────
  const total = state.kind === 'ready' ? state.data.total : 0;
  const limit = state.kind === 'ready' ? state.data.limit : PAGE_SIZE;
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const canGoBack = offset > 0;
  const canGoForward =
    state.kind === 'ready' && offset + limit < state.data.total;

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
          displayName={identity?.displayName}
          username={identity?.username}
        />

        <div className="mt-8">
          <header className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-[clamp(28px,4vw,38px)] font-extrabold tracking-[-.045em]">
                История заказов
              </h1>
              <p className="mt-2 text-sm leading-[1.6] text-[#aaa5b9]">
                Заказы, оформленные с применением вашего промокода. Сортировка —
                от новых к старым.
              </p>
            </div>
            {state.kind === 'ready' && state.data.total > 0 ? (
              <div
                className="text-xs uppercase tracking-[.12em] text-[#706b80]"
                style={{ fontFamily: 'var(--font-jetbrains-mono), monospace' }}
              >
                Всего {state.data.total}
              </div>
            ) : null}
          </header>

          <div className="mt-6">
            {state.kind === 'loading' && <OrdersSkeleton />}

            {state.kind === 'error' && (
              <div
                role="alert"
                className="rounded-2xl border border-[rgba(239,68,68,.32)] bg-[rgba(239,68,68,.08)] p-5 text-sm text-[#fecaca]"
              >
                {state.message}
                <button
                  type="button"
                  onClick={() => loadOrders(offset)}
                  className="ml-3 inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/[.04] px-3 py-1.5 text-xs font-semibold text-[#f7f5ff] hover:bg-white/[.08]"
                >
                  Повторить
                </button>
              </div>
            )}

            {state.kind === 'ready' && state.data.items.length === 0 && (
              <EmptyState />
            )}

            {state.kind === 'ready' && state.data.items.length > 0 && (
              <>
                <OrdersTable items={state.data.items} />
                <Pagination
                  page={currentPage}
                  totalPages={totalPages}
                  canGoBack={canGoBack}
                  canGoForward={canGoForward}
                  onBack={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
                  onForward={() => setOffset((o) => o + PAGE_SIZE)}
                />
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Subcomponents
// ────────────────────────────────────────────────────────────────────────

function OrdersSkeleton() {
  return (
    <div className="space-y-2" aria-hidden>
      <div className="h-12 rounded-2xl bg-white/[.03]" />
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="h-14 rounded-2xl border border-white/[.05] bg-white/[.02]"
        />
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div
      className="rounded-3xl border border-white/[.07] bg-white/[.02] p-10 text-center"
      role="status"
    >
      <div
        aria-hidden
        className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl text-2xl"
        style={{
          background: 'rgba(143,92,255,.10)',
          border: '1px solid rgba(143,92,255,.24)',
          color: '#b79dff',
        }}
      >
        ◯
      </div>
      <h2 className="text-lg font-extrabold tracking-[-.02em] text-[#f7f5ff]">
        Заказов пока нет
      </h2>
      <p className="mx-auto mt-2 max-w-[480px] text-sm leading-[1.6] text-[#aaa5b9]">
        У вас пока нет заказов с применённым промокодом. Поделитесь промокодом
        со своей аудиторией.
      </p>
    </div>
  );
}

function OrdersTable({ items }: { items: OrderRow[] }) {
  return (
    <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/[.025]">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr
              className="text-left text-[11px] uppercase tracking-[.12em] text-[#706b80]"
              style={{ borderBottom: '1px solid rgba(255,255,255,.06)' }}
            >
              <th className="px-5 py-3 font-semibold">Дата</th>
              <th className="px-5 py-3 font-semibold">Заказ</th>
              <th className="px-5 py-3 text-right font-semibold">
                Сумма заказа
              </th>
              <th className="px-5 py-3 text-right font-semibold">
                Сумма комиссии
              </th>
              <th className="px-5 py-3 font-semibold">Статус заказа</th>
              <th className="px-5 py-3 font-semibold">Статус комиссии</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr
                key={row.orderId}
                className="text-[#cbc6d6] transition-colors hover:bg-white/[.02]"
                style={{ borderTop: '1px solid rgba(255,255,255,.04)' }}
              >
                <td
                  className="whitespace-nowrap px-5 py-3 text-[13px] tabular-nums text-[#aaa5b9]"
                  style={{
                    fontFamily: 'var(--font-jetbrains-mono), monospace',
                  }}
                >
                  {dateFormatter.format(new Date(row.createdAt))}
                </td>
                <td className="px-5 py-3">
                  <div
                    className="text-[13px] font-extrabold text-[#f7f5ff]"
                    style={{
                      fontFamily: 'var(--font-jetbrains-mono), monospace',
                    }}
                  >
                    {row.orderId}
                  </div>
                  <div className="mt-0.5 text-[11px] text-[#706b80]">
                    {ruVbucks.format(row.vbucksAmount)} V-Bucks
                  </div>
                </td>
                <td className="whitespace-nowrap px-5 py-3 text-right tabular-nums text-[#f7f5ff]">
                  {ruVbucks.format(Math.round(row.priceTRY * 100) / 100)}{' '}
                  <span className="text-[#706b80]">₺</span>
                </td>
                <td className="whitespace-nowrap px-5 py-3 text-right tabular-nums">
                  <span className="font-extrabold text-[#f7f5ff]">
                    {formatMoney(row.commissionAmount)}
                  </span>
                </td>
                <td className="whitespace-nowrap px-5 py-3">
                  <OrderStatusBadge status={row.status} />
                </td>
                <td className="whitespace-nowrap px-5 py-3">
                  <CommissionStatusBadge status={row.commissionStatus} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function OrderStatusBadge({ status }: { status: string }) {
  // Order statuses we may see (see backend OrderStatusEnum):
  //   pending, awaiting_auth, auth_completed, processing, completed,
  //   failed, refunded.
  const map: Record<
    string,
    { label: string; bg: string; border: string; color: string }
  > = {
    completed: {
      label: 'Выполнен',
      bg: 'rgba(65,229,157,.10)',
      border: 'rgba(65,229,157,.32)',
      color: '#41e59d',
    },
    processing: {
      label: 'В обработке',
      bg: 'rgba(56,189,248,.10)',
      border: 'rgba(56,189,248,.32)',
      color: '#7dd3fc',
    },
    awaiting_auth: {
      label: 'Ожидает входа',
      bg: 'rgba(250,204,21,.10)',
      border: 'rgba(250,204,21,.32)',
      color: '#fde047',
    },
    auth_completed: {
      label: 'Авторизован',
      bg: 'rgba(56,189,248,.10)',
      border: 'rgba(56,189,248,.32)',
      color: '#7dd3fc',
    },
    pending: {
      label: 'В очереди',
      bg: 'rgba(250,204,21,.10)',
      border: 'rgba(250,204,21,.32)',
      color: '#fde047',
    },
    failed: {
      label: 'Не выполнен',
      bg: 'rgba(239,68,68,.10)',
      border: 'rgba(239,68,68,.32)',
      color: '#fca5a5',
    },
    refunded: {
      label: 'Возврат',
      bg: 'rgba(148,163,184,.10)',
      border: 'rgba(148,163,184,.32)',
      color: '#cbd5e1',
    },
  };
  const meta = map[status] ?? {
    label: status,
    bg: 'rgba(148,163,184,.10)',
    border: 'rgba(148,163,184,.32)',
    color: '#cbd5e1',
  };
  return (
    <span
      className="inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-extrabold"
      style={{
        background: meta.bg,
        borderColor: meta.border,
        color: meta.color,
      }}
    >
      {meta.label}
    </span>
  );
}

function CommissionStatusBadge({
  status,
}: {
  status: 'pending' | 'approved' | 'cancelled' | null;
}) {
  if (!status) {
    return (
      <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[.03] px-2.5 py-1 text-[11px] font-semibold text-[#706b80]">
        Нет данных
      </span>
    );
  }
  const map: Record<
    'pending' | 'approved' | 'cancelled',
    { label: string; bg: string; border: string; color: string }
  > = {
    pending: {
      label: 'Ожидание',
      bg: 'rgba(250,204,21,.10)',
      border: 'rgba(250,204,21,.32)',
      color: '#fde047',
    },
    approved: {
      label: 'Подтверждена',
      bg: 'rgba(65,229,157,.10)',
      border: 'rgba(65,229,157,.32)',
      color: '#41e59d',
    },
    cancelled: {
      label: 'Отменена',
      bg: 'rgba(148,163,184,.10)',
      border: 'rgba(148,163,184,.32)',
      color: '#cbd5e1',
    },
  };
  const meta = map[status];
  return (
    <span
      className="inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-extrabold"
      style={{
        background: meta.bg,
        borderColor: meta.border,
        color: meta.color,
      }}
    >
      {meta.label}
    </span>
  );
}

interface PaginationProps {
  page: number;
  totalPages: number;
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
}

function Pagination({
  page,
  totalPages,
  canGoBack,
  canGoForward,
  onBack,
  onForward,
}: PaginationProps) {
  return (
    <div className="mt-5 flex items-center justify-between gap-3">
      <button
        type="button"
        onClick={onBack}
        disabled={!canGoBack}
        className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-white/[.04] px-4 py-2.5 text-xs font-semibold text-[#cbc6d6] transition-colors hover:text-[#f7f5ff] disabled:cursor-not-allowed disabled:opacity-40"
      >
        ← Назад
      </button>
      <div
        className="text-xs uppercase tracking-[.12em] text-[#706b80]"
        style={{ fontFamily: 'var(--font-jetbrains-mono), monospace' }}
      >
        Стр. {page} / {totalPages}
      </div>
      <button
        type="button"
        onClick={onForward}
        disabled={!canGoForward}
        className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-white/[.04] px-4 py-2.5 text-xs font-semibold text-[#cbc6d6] transition-colors hover:text-[#f7f5ff] disabled:cursor-not-allowed disabled:opacity-40"
      >
        Вперёд →
      </button>
    </div>
  );
}
