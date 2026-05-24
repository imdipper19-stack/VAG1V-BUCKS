'use client';

import {
  Fragment,
  useCallback,
  useEffect,
  useState,
  type FormEvent,
} from 'react';
import { useRouter } from 'next/navigation';
import CabinetNav from '../CabinetNav';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

/**
 * Partner cabinet — payouts (`/partner/cabinet/payouts`).
 *
 * Two stacked sections (Requirement 12.4 + 13.1–13.5):
 *
 *   1. «Запросить выплату» form — amount + requisites textarea, with
 *      live "Доступно: X ₽" helper. Submit hits
 *      `POST /api/partner/payouts`. On success we clear the form and
 *      refetch both the dashboard (for the updated balance) and the
 *      payout list — that's the cheapest way to keep the UI honest
 *      across the dynamic balance computation in
 *      {@link PayoutService.getBalance}, which considers any
 *      requested/processing payouts as already-spent.
 *
 *   2. «История выплат» — table of every payout with status badge.
 *      `requisites` cells truncate by default; clicking a row toggles
 *      the full text. `rejection_reason` (when present) renders below
 *      the table row in a smaller font as required.
 *
 * Data fetches:
 *   - Initial mount: `/api/partner/dashboard` (balance + identity)
 *     and `/api/partner/payouts` (history) in parallel.
 *   - 401 from either → redirect to `/partner/login`.
 *   - Form errors come from the backend's BadRequestException — for
 *     example "Запрашиваемая сумма превышает доступный баланс" — and
 *     are surfaced verbatim.
 */

interface DashboardData {
  partnerBalance: number;
  displayName: string;
  username: string;
}

type PayoutStatus = 'requested' | 'processing' | 'paid' | 'rejected';

interface PayoutRow {
  id: string;
  partnerId: string;
  amount: string | number;
  requisites: string;
  status: PayoutStatus;
  rejectionReason: string | null;
  processedBy: string | null;
  requestedAt: string;
  processingAt: string | null;
  paidAt: string | null;
  rejectedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
  dateStyle: 'short',
  timeStyle: 'short',
});

const ruMoney = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'RUB',
  maximumFractionDigits: 2,
});
const formatMoney = (value: number) => ruMoney.format(value || 0);

/** Mirrors the backend DTO's `MinLength(5)` on `requisites`. */
const MIN_REQUISITES_LENGTH = 5;

export default function PartnerPayoutsPage() {
  const router = useRouter();

  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [payouts, setPayouts] = useState<PayoutRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // form state
  const [amount, setAmount] = useState('');
  const [requisites, setRequisites] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  // expanded row id (for full requisites text)
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // ── data loading ───────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    setLoadError(null);
    try {
      const [dashRes, payoutsRes] = await Promise.all([
        fetch(`${API_URL}/partner/dashboard`, {
          method: 'GET',
          credentials: 'include',
        }),
        fetch(`${API_URL}/partner/payouts`, {
          method: 'GET',
          credentials: 'include',
        }),
      ]);

      if (dashRes.status === 401 || payoutsRes.status === 401) {
        router.push('/partner/login');
        return;
      }

      if (!dashRes.ok || !payoutsRes.ok) {
        setLoadError(
          'Не удалось загрузить данные кабинета. Попробуйте обновить страницу.',
        );
        setLoading(false);
        return;
      }

      const dashBody = await dashRes.json();
      const payoutsBody = await payoutsRes.json();

      const dashData = dashBody?.data;
      if (
        !dashData ||
        typeof dashData.partnerBalance !== 'number' ||
        typeof dashData.displayName !== 'string'
      ) {
        setLoadError('Получен некорректный ответ от сервера.');
        setLoading(false);
        return;
      }
      setDashboard({
        partnerBalance: dashData.partnerBalance,
        displayName: dashData.displayName,
        username: dashData.username,
      });

      const list = payoutsBody?.data;
      setPayouts(Array.isArray(list) ? (list as PayoutRow[]) : []);

      setLoading(false);
    } catch {
      setLoadError(
        'Не удалось загрузить данные кабинета. Проверьте подключение к интернету.',
      );
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // ── form handlers ──────────────────────────────────────────────────
  const balance = dashboard?.partnerBalance ?? 0;
  const parsedAmount = Number(amount.replace(',', '.'));
  const isValidAmount =
    Number.isFinite(parsedAmount) && parsedAmount > 0 && parsedAmount <= balance;
  const isValidRequisites = requisites.trim().length >= MIN_REQUISITES_LENGTH;
  const canSubmit = !submitting && isValidAmount && isValidRequisites;

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting) return;

    setFormError(null);
    setSuccessNotice(null);

    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setFormError('Введите корректную сумму больше 0.');
      return;
    }
    if (parsedAmount > balance) {
      setFormError('Запрашиваемая сумма превышает доступный баланс.');
      return;
    }
    if (requisites.trim().length < MIN_REQUISITES_LENGTH) {
      setFormError(
        `Реквизиты должны содержать не менее ${MIN_REQUISITES_LENGTH} символов.`,
      );
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(`${API_URL}/partner/payouts`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: parsedAmount,
          requisites: requisites.trim(),
        }),
      });

      if (response.status === 401) {
        router.push('/partner/login');
        return;
      }

      if (response.status === 201 || response.status === 200) {
        setAmount('');
        setRequisites('');
        setSuccessNotice('Заявка создана. Ожидайте рассмотрения.');
        // Refetch in the background so the balance and payouts list
        // reflect the new request (the dynamic balance subtracts
        // requested+processing payouts, so the "Доступно" helper
        // updates immediately).
        loadAll();
      } else {
        let serverMessage = '';
        try {
          const data = await response.json();
          if (Array.isArray(data?.message)) {
            serverMessage = data.message.join(' ');
          } else if (typeof data?.message === 'string') {
            serverMessage = data.message;
          }
        } catch {
          /* not JSON — fall through */
        }
        setFormError(
          serverMessage ||
            'Не удалось создать заявку на выплату. Попробуйте ещё раз.',
        );
      }
    } catch {
      setFormError(
        'Не удалось создать заявку на выплату. Проверьте подключение к интернету.',
      );
    } finally {
      setSubmitting(false);
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
          displayName={dashboard?.displayName}
          username={dashboard?.username}
        />

        <div className="mt-8 space-y-8">
          {loadError && (
            <div
              role="alert"
              className="rounded-2xl border border-[rgba(239,68,68,.32)] bg-[rgba(239,68,68,.08)] p-5 text-sm text-[#fecaca]"
            >
              {loadError}
              <button
                type="button"
                onClick={loadAll}
                className="ml-3 inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/[.04] px-3 py-1.5 text-xs font-semibold text-[#f7f5ff] hover:bg-white/[.08]"
              >
                Повторить
              </button>
            </div>
          )}

          {/* Section 1: request form */}
          <section
            aria-labelledby="payout-form-heading"
            className="rounded-3xl border border-white/10 bg-white/[.025] p-6 md:p-8"
          >
            <header className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h1
                  id="payout-form-heading"
                  className="text-[clamp(22px,3vw,28px)] font-extrabold tracking-[-.035em]"
                >
                  Запросить выплату
                </h1>
                <p className="mt-2 text-sm leading-[1.6] text-[#aaa5b9]">
                  Укажите сумму к выплате и реквизиты. Заявка будет рассмотрена
                  владельцем магазина.
                </p>
              </div>
              <BalanceBadge balance={balance} loading={loading} />
            </header>

            {successNotice && (
              <div
                role="status"
                aria-live="polite"
                className="mt-6 rounded-2xl border border-[rgba(65,229,157,.32)] bg-[rgba(65,229,157,.08)] p-4 text-sm text-[#41e59d]"
              >
                {successNotice}
              </div>
            )}

            <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-5">
              <div>
                <label
                  htmlFor="payout-amount"
                  className="mb-2 block text-xs font-semibold uppercase tracking-[.08em] text-[#aaa5b9]"
                >
                  Сумма к выплате, ₽
                </label>
                <input
                  id="payout-amount"
                  type="number"
                  inputMode="decimal"
                  min={0.01}
                  max={balance > 0 ? balance : undefined}
                  step="0.01"
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value);
                    if (formError) setFormError(null);
                    if (successNotice) setSuccessNotice(null);
                  }}
                  disabled={submitting || loading}
                  className="w-full rounded-2xl border border-white/10 bg-white/[.03] px-4 py-3 text-sm text-[#f7f5ff] placeholder:text-[#5a5564] outline-none transition-colors focus:border-[rgba(143,92,255,.55)] focus:bg-white/[.05] disabled:cursor-not-allowed disabled:opacity-60"
                  placeholder="например, 1500.00"
                />
                <p className="mt-1.5 text-xs text-[#706b80]">
                  Минимум 0,01 ₽. Не больше доступного баланса.
                </p>
              </div>

              <div>
                <label
                  htmlFor="payout-requisites"
                  className="mb-2 block text-xs font-semibold uppercase tracking-[.08em] text-[#aaa5b9]"
                >
                  Реквизиты
                </label>
                <textarea
                  id="payout-requisites"
                  value={requisites}
                  onChange={(e) => {
                    setRequisites(e.target.value);
                    if (formError) setFormError(null);
                    if (successNotice) setSuccessNotice(null);
                  }}
                  disabled={submitting || loading}
                  rows={4}
                  maxLength={2000}
                  className="min-h-[120px] w-full resize-y rounded-2xl border border-white/10 bg-white/[.03] px-4 py-3 text-sm text-[#f7f5ff] placeholder:text-[#5a5564] outline-none transition-colors focus:border-[rgba(143,92,255,.55)] focus:bg-white/[.05] disabled:cursor-not-allowed disabled:opacity-60"
                  placeholder="Карта/IBAN/электронный кошелёк или иной способ перевода. Свободный текст."
                />
                <div className="mt-1 flex items-center justify-between">
                  <p className="text-xs text-[#706b80]">
                    Не менее {MIN_REQUISITES_LENGTH} символов. Эти данные увидит
                    владелец магазина при обработке заявки.
                  </p>
                  <span
                    className="text-[11px] tabular-nums text-[#706b80]"
                    style={{
                      fontFamily: 'var(--font-jetbrains-mono), monospace',
                    }}
                  >
                    {requisites.length} / 2000
                  </span>
                </div>
              </div>

              {formError && (
                <div
                  role="alert"
                  className="rounded-2xl border border-[rgba(239,68,68,.32)] bg-[rgba(239,68,68,.08)] px-4 py-3 text-sm text-[#fecaca]"
                >
                  {formError}
                </div>
              )}

              <button
                type="submit"
                disabled={!canSubmit}
                className="inline-flex w-full items-center justify-center rounded-2xl px-6 py-4 text-sm font-extrabold text-[#fbfaff] transition-transform hover:-translate-y-0.5 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                style={{
                  background: 'linear-gradient(135deg, #8f5cff, #6d42e8)',
                  boxShadow: '0 0 28px rgba(143,92,255,.34)',
                }}
              >
                {submitting ? 'Отправляем…' : 'Запросить выплату'}
              </button>
            </form>
          </section>

          {/* Section 2: history */}
          <section aria-labelledby="payout-history-heading">
            <header className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2
                  id="payout-history-heading"
                  className="text-[clamp(22px,3vw,28px)] font-extrabold tracking-[-.035em]"
                >
                  История выплат
                </h2>
                <p className="mt-2 text-sm leading-[1.6] text-[#aaa5b9]">
                  Все ваши заявки на выплату. Сортировка — от новых к старым.
                </p>
              </div>
              {!loading && payouts.length > 0 ? (
                <div
                  className="text-xs uppercase tracking-[.12em] text-[#706b80]"
                  style={{ fontFamily: 'var(--font-jetbrains-mono), monospace' }}
                >
                  Всего {payouts.length}
                </div>
              ) : null}
            </header>

            <div className="mt-5">
              {loading && <PayoutsSkeleton />}

              {!loading && payouts.length === 0 && !loadError && (
                <PayoutsEmptyState />
              )}

              {!loading && payouts.length > 0 && (
                <PayoutsTable
                  items={payouts}
                  expandedId={expandedId}
                  onToggle={(id) =>
                    setExpandedId((prev) => (prev === id ? null : id))
                  }
                />
              )}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Subcomponents
// ────────────────────────────────────────────────────────────────────────

function BalanceBadge({
  balance,
  loading,
}: {
  balance: number;
  loading: boolean;
}) {
  return (
    <div
      className="flex items-baseline gap-2 rounded-2xl border border-[rgba(143,92,255,.28)] bg-[rgba(143,92,255,.08)] px-4 py-3"
      aria-live="polite"
    >
      <span className="text-[11px] font-semibold uppercase tracking-[.12em] text-[#aaa5b9]">
        Доступно
      </span>
      <span
        className="text-base font-extrabold tabular-nums text-[#f7f5ff]"
        style={{ textShadow: '0 0 24px rgba(143,92,255,.36)' }}
      >
        {loading ? '…' : formatMoney(balance)}
      </span>
    </div>
  );
}

function PayoutsSkeleton() {
  return (
    <div className="space-y-2" aria-hidden>
      <div className="h-12 rounded-2xl bg-white/[.03]" />
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="h-14 rounded-2xl border border-white/[.05] bg-white/[.02]"
        />
      ))}
    </div>
  );
}

function PayoutsEmptyState() {
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
        ₽
      </div>
      <h3 className="text-lg font-extrabold tracking-[-.02em] text-[#f7f5ff]">
        Заявок на выплату пока нет
      </h3>
      <p className="mx-auto mt-2 max-w-[480px] text-sm leading-[1.6] text-[#aaa5b9]">
        У вас пока нет заявок на выплату. Когда накопится баланс, заполните
        форму выше.
      </p>
    </div>
  );
}

interface PayoutsTableProps {
  items: PayoutRow[];
  expandedId: string | null;
  onToggle: (id: string) => void;
}

function PayoutsTable({ items, expandedId, onToggle }: PayoutsTableProps) {
  return (
    <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/[.025]">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr
              className="text-left text-[11px] uppercase tracking-[.12em] text-[#706b80]"
              style={{ borderBottom: '1px solid rgba(255,255,255,.06)' }}
            >
              <th className="px-5 py-3 font-semibold">Дата создания</th>
              <th className="px-5 py-3 text-right font-semibold">Сумма</th>
              <th className="px-5 py-3 font-semibold">Реквизиты</th>
              <th className="px-5 py-3 font-semibold">Статус</th>
              <th className="px-5 py-3 font-semibold">Дата выплаты</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => {
              const expanded = expandedId === row.id;
              const requisitesShort =
                row.requisites.length > 60
                  ? `${row.requisites.slice(0, 60)}…`
                  : row.requisites;
              const amountNumber =
                typeof row.amount === 'number' ? row.amount : Number(row.amount);
              const paidAt = row.paidAt ?? row.rejectedAt;
              return (
                <Fragment key={row.id}>
                  <tr
                    className="text-[#cbc6d6] transition-colors hover:bg-white/[.02]"
                    style={{ borderTop: '1px solid rgba(255,255,255,.04)' }}
                  >
                    <td
                      className="whitespace-nowrap px-5 py-3 text-[13px] tabular-nums text-[#aaa5b9]"
                      style={{
                        fontFamily: 'var(--font-jetbrains-mono), monospace',
                      }}
                    >
                      {dateFormatter.format(
                        new Date(row.requestedAt ?? row.createdAt),
                      )}
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 text-right tabular-nums">
                      <span className="font-extrabold text-[#f7f5ff]">
                        {formatMoney(amountNumber)}
                      </span>
                    </td>
                    <td className="px-5 py-3 align-top">
                      <button
                        type="button"
                        onClick={() => onToggle(row.id)}
                        aria-expanded={expanded}
                        className="text-left text-[13px] text-[#cbc6d6] transition-colors hover:text-[#f7f5ff]"
                      >
                        {expanded ? (
                          <span className="block whitespace-pre-wrap break-words">
                            {row.requisites}
                          </span>
                        ) : (
                          <span className="block">{requisitesShort}</span>
                        )}
                        <span className="mt-1 inline-block text-[11px] text-[#706b80]">
                          {expanded ? 'Свернуть' : 'Развернуть'}
                        </span>
                      </button>
                    </td>
                    <td className="whitespace-nowrap px-5 py-3">
                      <PayoutStatusBadge status={row.status} />
                    </td>
                    <td
                      className="whitespace-nowrap px-5 py-3 text-[13px] tabular-nums text-[#aaa5b9]"
                      style={{
                        fontFamily: 'var(--font-jetbrains-mono), monospace',
                      }}
                    >
                      {paidAt ? dateFormatter.format(new Date(paidAt)) : '—'}
                    </td>
                  </tr>
                  {row.status === 'rejected' && row.rejectionReason ? (
                    <tr
                      style={{ borderTop: '1px dashed rgba(239,68,68,.18)' }}
                    >
                      <td colSpan={5} className="px-5 py-3">
                        <div className="text-[11px] uppercase tracking-[.12em] text-[#fca5a5]">
                          Причина отклонения
                        </div>
                        <div className="mt-1 text-xs leading-[1.5] text-[#aaa5b9]">
                          {row.rejectionReason}
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PayoutStatusBadge({ status }: { status: PayoutStatus }) {
  const map: Record<
    PayoutStatus,
    { label: string; bg: string; border: string; color: string }
  > = {
    requested: {
      label: 'Запрошена',
      bg: 'rgba(250,204,21,.10)',
      border: 'rgba(250,204,21,.32)',
      color: '#fde047',
    },
    processing: {
      label: 'В обработке',
      bg: 'rgba(56,189,248,.10)',
      border: 'rgba(56,189,248,.32)',
      color: '#7dd3fc',
    },
    paid: {
      label: 'Выплачена',
      bg: 'rgba(65,229,157,.10)',
      border: 'rgba(65,229,157,.32)',
      color: '#41e59d',
    },
    rejected: {
      label: 'Отклонена',
      bg: 'rgba(239,68,68,.10)',
      border: 'rgba(239,68,68,.32)',
      color: '#fca5a5',
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
