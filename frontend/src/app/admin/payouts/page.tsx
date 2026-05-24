'use client';

/**
 * Admin · Payout requests page (Task 17.4, Requirement 14.1–14.7).
 *
 * Lists every Payout_Request with a status filter and exposes the
 * three admin actions:
 *   - «Взять в работу»      → status=processing  (only requested)
 *   - «Отметить выплаченной» → status=paid        (requested|processing)
 *   - «Отклонить»            → status=rejected    (requested|processing)
 *
 * Reject opens a small dialog with an optional reason textarea so the
 * admin can provide a Russian-language explanation that the partner
 * sees in their cabinet.
 *
 * Each row links to the corresponding partner detail page so the admin
 * can pivot to "see context for this partner" with one click.
 *
 * Auth: shared `api` axios client auto-attaches `admin_token` Bearer.
 */

import { Fragment, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import { clearAdminSession, getAdminToken, getAdminUser } from '@/lib/auth';

// ─── types ──────────────────────────────────────────────────────────────

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

interface PartnerLite {
  id: string;
  username: string;
  displayName: string;
}

const STATUS_TABS: Array<{ value: PayoutStatus | 'all'; label: string }> = [
  { value: 'all', label: 'Все' },
  { value: 'requested', label: 'Новые' },
  { value: 'processing', label: 'В работе' },
  { value: 'paid', label: 'Выплачены' },
  { value: 'rejected', label: 'Отклонены' },
];

// ─── helpers ────────────────────────────────────────────────────────────

function formatRub(amount: number | string): string {
  const n = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isFinite(n)) return '—';
  return `${n.toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ₽`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

function extractApiError(err: unknown, fallback: string): string {
  const data = (err as { response?: { data?: { message?: string | string[] } } })
    ?.response?.data;
  if (Array.isArray(data?.message)) return data.message[0] ?? fallback;
  if (typeof data?.message === 'string') return data.message;
  return fallback;
}

// ─── component ──────────────────────────────────────────────────────────

export default function AdminPayoutsPage() {
  const router = useRouter();
  const [authReady, setAuthReady] = useState(false);

  const [payouts, setPayouts] = useState<PayoutRow[]>([]);
  const [partnersById, setPartnersById] = useState<Record<string, PartnerLite>>(
    {},
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<PayoutStatus | 'all'>('requested');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [rejectTarget, setRejectTarget] = useState<PayoutRow | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);

  useEffect(() => {
    const token = getAdminToken();
    const user = getAdminUser();
    if (!token || !user) {
      clearAdminSession();
      router.push('/admin/login');
      return;
    }
    setAuthReady(true);
  }, [router]);

  // Load partner display info once so the table can show name/login per
  // row without N round-trips. Cheap (<= ~100 rows in realistic cases).
  useEffect(() => {
    if (!authReady) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await api.get('/admin/partners');
        if (cancelled) return;
        const list = (response.data?.data ?? []) as PartnerLite[];
        setPartnersById(
          list.reduce<Record<string, PartnerLite>>((acc, p) => {
            acc[p.id] = p;
            return acc;
          }, {}),
        );
      } catch {
        // Non-fatal — the table falls back to showing the partnerId.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authReady]);

  useEffect(() => {
    if (!authReady) return;
    let cancelled = false;
    const fetchList = async () => {
      setLoading(true);
      setError(null);
      try {
        const params = activeTab === 'all' ? undefined : { status: activeTab };
        const response = await api.get('/admin/payouts', { params });
        if (!cancelled) {
          setPayouts(response.data?.data ?? []);
        }
      } catch (err) {
        if (!cancelled) {
          setError(extractApiError(err, 'Не удалось загрузить выплаты'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchList();
    return () => {
      cancelled = true;
    };
  }, [activeTab, authReady]);

  const counts = useMemo(() => {
    const by: Record<PayoutStatus, number> = {
      requested: 0,
      processing: 0,
      paid: 0,
      rejected: 0,
    };
    for (const p of payouts) by[p.status] += 1;
    return { all: payouts.length, ...by };
  }, [payouts]);

  const updateStatus = async (
    payout: PayoutRow,
    status: PayoutStatus,
    reason?: string,
  ) => {
    setActingId(payout.id);
    try {
      const body: Record<string, unknown> = { status };
      if (status === 'rejected' && reason) body.rejectionReason = reason;
      const response = await api.patch(
        `/admin/payouts/${payout.id}/status`,
        body,
      );
      const updated: PayoutRow = response.data?.data;
      setPayouts((prev) =>
        prev.map((p) => (p.id === payout.id ? { ...p, ...updated } : p)),
      );
    } catch (err) {
      alert(extractApiError(err, 'Не удалось обновить статус'));
    } finally {
      setActingId(null);
    }
  };

  if (!authReady) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-12 h-12 border-2 border-transparent border-t-purple-400 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <AdminHeader active="payouts" />

      <main className="p-4 sm:p-9 max-w-[1400px] mx-auto">
        <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-2xl font-bold" style={{ color: '#f4f4f5' }}>
            Заявки на выплату
          </h1>
          <Link
            href="/admin"
            className="text-sm transition-colors hover:text-white"
            style={{ color: '#71717a' }}
          >
            ← К панели
          </Link>
        </div>

        <div
          className="flex gap-1 mb-6 overflow-x-auto"
          style={{ borderBottom: '1px solid rgba(255,255,255,.06)' }}
        >
          {STATUS_TABS.map((tab) => {
            const active = activeTab === tab.value;
            const count =
              tab.value === 'all'
                ? counts.all
                : counts[tab.value as PayoutStatus];
            return (
              <button
                key={tab.value}
                type="button"
                onClick={() => setActiveTab(tab.value)}
                className={`px-4 py-3 text-sm font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'text-purple-400 border-b-2 border-purple-400'
                    : 'text-gray-400 hover:text-gray-300'
                }`}
              >
                {tab.label}
                {count > 0 && (
                  <span
                    className="ml-2 px-2 py-0.5 rounded-full text-xs"
                    style={{
                      background: active
                        ? 'rgba(139,92,246,.18)'
                        : 'rgba(255,255,255,.06)',
                      color: active ? '#a78bfa' : '#71717a',
                    }}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {error && (
          <div
            className="p-4 rounded-xl mb-5 text-sm"
            style={{
              background: 'rgba(239,68,68,.12)',
              border: '1px solid rgba(239,68,68,.3)',
              color: '#fecaca',
            }}
          >
            {error}
          </div>
        )}

        <div
          className="rounded-[24px] overflow-hidden"
          style={{
            background: 'rgba(255,255,255,.03)',
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(255,255,255,.06)',
          }}
        >
          {loading ? (
            <div className="p-8 text-center" style={{ color: '#71717a' }}>
              Загрузка…
            </div>
          ) : payouts.length === 0 ? (
            <div className="p-8 text-center" style={{ color: '#71717a' }}>
              Заявок на выплату нет.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1080px]">
                <thead>
                  <tr style={{ background: 'rgba(255,255,255,.02)' }}>
                    {[
                      'Дата запроса',
                      'Партнёр',
                      'Сумма',
                      'Реквизиты',
                      'Статус',
                      'Дата выплаты',
                      'Действия',
                    ].map((h) => (
                      <th
                        key={h}
                        className="px-5 py-4 text-left text-xs uppercase tracking-widest font-medium"
                        style={{ color: '#71717a' }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {payouts.map((p) => {
                    const partner = partnersById[p.partnerId];
                    const expanded = expandedId === p.id;
                    const acting = actingId === p.id;
                    return (
                      <Fragment key={p.id}>
                        <tr
                          className="cursor-pointer hover:bg-white/5"
                          style={{
                            borderBottom: '1px solid rgba(255,255,255,.04)',
                          }}
                          onClick={() =>
                            setExpandedId((prev) =>
                              prev === p.id ? null : p.id,
                            )
                          }
                        >
                          <td className="px-5 py-4 text-sm whitespace-nowrap" style={{ color: '#a1a1aa' }}>
                            {formatDate(p.requestedAt)}
                          </td>
                          <td
                            className="px-5 py-4"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Link
                              href={`/admin/partners/${p.partnerId}`}
                              className="text-sm font-medium hover:underline"
                              style={{ color: '#a78bfa' }}
                            >
                              {partner?.displayName ?? '—'}
                            </Link>
                            {partner?.username && (
                              <div
                                className="text-xs font-mono mt-0.5"
                                style={{ color: '#71717a' }}
                              >
                                {partner.username}
                              </div>
                            )}
                          </td>
                          <td className="px-5 py-4 text-sm font-mono font-bold" style={{ color: '#f4f4f5' }}>
                            {formatRub(p.amount)}
                          </td>
                          <td className="px-5 py-4 text-sm" style={{ color: '#a1a1aa' }}>
                            <span className="block max-w-[260px] truncate">
                              {p.requisites}
                            </span>
                            <span className="text-xs" style={{ color: '#71717a' }}>
                              {expanded ? 'Скрыть' : 'Показать полностью'}
                            </span>
                          </td>
                          <td className="px-5 py-4">
                            <PayoutStatusBadge status={p.status} />
                          </td>
                          <td className="px-5 py-4 text-sm whitespace-nowrap" style={{ color: '#a1a1aa' }}>
                            {p.paidAt ? formatDate(p.paidAt) : '—'}
                          </td>
                          <td
                            className="px-5 py-4"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <PayoutActions
                              payout={p}
                              acting={acting}
                              onTake={() => updateStatus(p, 'processing')}
                              onPay={() => updateStatus(p, 'paid')}
                              onReject={() => setRejectTarget(p)}
                            />
                          </td>
                        </tr>
                        {expanded && (
                          <tr style={{ background: 'rgba(255,255,255,.015)' }}>
                            <td colSpan={7} className="px-5 py-4 text-sm">
                              <div className="grid gap-4 md:grid-cols-2">
                                <div>
                                  <div
                                    className="text-xs uppercase tracking-widest mb-1.5"
                                    style={{ color: '#71717a' }}
                                  >
                                    Реквизиты
                                  </div>
                                  <p
                                    className="whitespace-pre-wrap"
                                    style={{ color: '#cbd5e1' }}
                                  >
                                    {p.requisites}
                                  </p>
                                </div>
                                <div className="space-y-2">
                                  <div className="flex justify-between text-xs">
                                    <span style={{ color: '#71717a' }}>
                                      Создана
                                    </span>
                                    <span style={{ color: '#a1a1aa' }}>
                                      {formatDate(p.createdAt)}
                                    </span>
                                  </div>
                                  {p.processingAt && (
                                    <div className="flex justify-between text-xs">
                                      <span style={{ color: '#71717a' }}>
                                        Взята в работу
                                      </span>
                                      <span style={{ color: '#a1a1aa' }}>
                                        {formatDate(p.processingAt)}
                                      </span>
                                    </div>
                                  )}
                                  {p.paidAt && (
                                    <div className="flex justify-between text-xs">
                                      <span style={{ color: '#71717a' }}>
                                        Выплачена
                                      </span>
                                      <span style={{ color: '#22c55e' }}>
                                        {formatDate(p.paidAt)}
                                      </span>
                                    </div>
                                  )}
                                  {p.rejectedAt && (
                                    <div className="flex justify-between text-xs">
                                      <span style={{ color: '#71717a' }}>
                                        Отклонена
                                      </span>
                                      <span style={{ color: '#ef4444' }}>
                                        {formatDate(p.rejectedAt)}
                                      </span>
                                    </div>
                                  )}
                                  {p.rejectionReason && (
                                    <div className="pt-2">
                                      <div
                                        className="text-xs uppercase tracking-widest mb-1"
                                        style={{ color: '#71717a' }}
                                      >
                                        Причина отказа
                                      </div>
                                      <p
                                        className="text-sm"
                                        style={{ color: '#fecaca' }}
                                      >
                                        {p.rejectionReason}
                                      </p>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      {rejectTarget && (
        <RejectDialog
          payout={rejectTarget}
          onClose={() => setRejectTarget(null)}
          onConfirm={async (reason) => {
            await updateStatus(rejectTarget, 'rejected', reason);
            setRejectTarget(null);
          }}
        />
      )}
    </div>
  );
}

// ─── shared header ──────────────────────────────────────────────────────

function AdminHeader({
  active,
}: {
  active: 'applications' | 'partners' | 'payouts';
}) {
  const items = [
    { key: 'applications', label: 'Заявки', href: '/admin/applications' },
    { key: 'partners', label: 'Партнёры', href: '/admin/partners' },
    { key: 'payouts', label: 'Выплаты', href: '/admin/payouts' },
  ] as const;
  return (
    <header
      className="sticky top-0 z-40 px-4 sm:px-9 py-4 flex justify-between items-center gap-3"
      style={{
        background: 'rgba(10,10,15,.9)',
        backdropFilter: 'blur(20px)',
        borderBottom: '1px solid rgba(255,255,255,.06)',
      }}
    >
      <Link href="/admin" className="flex items-center gap-3 min-w-0">
        <div
          className="w-9 h-9 flex-shrink-0 rounded-lg flex items-center justify-center font-extrabold text-base"
          style={{ background: 'linear-gradient(135deg,#8b5cf6,#a78bfa)' }}
        >
          V
        </div>
        <span className="font-bold text-base truncate" style={{ color: '#f4f4f5' }}>
          <span className="hidden sm:inline">Bag1V-Bucks </span>Admin
        </span>
      </Link>
      <nav className="flex items-center gap-1 text-sm">
        {items.map((item) => {
          const isActive = item.key === active;
          return (
            <Link
              key={item.key}
              href={item.href}
              className="px-3 py-2 rounded-lg transition-colors"
              style={
                isActive
                  ? { color: '#a78bfa', background: 'rgba(139,92,246,.1)' }
                  : { color: '#a1a1aa' }
              }
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}

// ─── status badge ───────────────────────────────────────────────────────

function PayoutStatusBadge({ status }: { status: PayoutStatus }) {
  const styles: Record<PayoutStatus, { bg: string; color: string; label: string }> = {
    requested: { bg: 'rgba(234,179,8,.12)', color: '#eab308', label: 'Новая' },
    processing: { bg: 'rgba(139,92,246,.12)', color: '#8b5cf6', label: 'В работе' },
    paid: { bg: 'rgba(34,197,94,.12)', color: '#22c55e', label: 'Выплачена' },
    rejected: { bg: 'rgba(239,68,68,.12)', color: '#ef4444', label: 'Отклонена' },
  };
  const s = styles[status];
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap"
      style={{ background: s.bg, color: s.color }}
    >
      <span className="w-1 h-1 rounded-full" style={{ background: s.color }} />
      {s.label}
    </span>
  );
}

// ─── per-row actions ────────────────────────────────────────────────────

function PayoutActions({
  payout,
  acting,
  onTake,
  onPay,
  onReject,
}: {
  payout: PayoutRow;
  acting: boolean;
  onTake: () => void;
  onPay: () => void;
  onReject: () => void;
}) {
  if (payout.status === 'paid' || payout.status === 'rejected') {
    return (
      <span className="text-xs" style={{ color: '#71717a' }}>
        —
      </span>
    );
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {payout.status === 'requested' && (
        <button
          type="button"
          onClick={onTake}
          disabled={acting}
          className="px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50"
          style={{
            background: 'rgba(139,92,246,.15)',
            border: '1px solid rgba(139,92,246,.3)',
            color: '#a78bfa',
          }}
        >
          Взять в работу
        </button>
      )}
      <button
        type="button"
        onClick={onPay}
        disabled={acting}
        className="px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50"
        style={{
          background: 'rgba(34,197,94,.15)',
          border: '1px solid rgba(34,197,94,.3)',
          color: '#22c55e',
        }}
      >
        ✓ Выплачено
      </button>
      <button
        type="button"
        onClick={onReject}
        disabled={acting}
        className="px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50"
        style={{
          background: 'rgba(239,68,68,.12)',
          border: '1px solid rgba(239,68,68,.3)',
          color: '#ef4444',
        }}
      >
        ✕ Отклонить
      </button>
    </div>
  );
}

// ─── reject dialog ──────────────────────────────────────────────────────

function RejectDialog({
  payout,
  onClose,
  onConfirm,
}: {
  payout: PayoutRow;
  onClose: () => void;
  onConfirm: (reason?: string) => void | Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleConfirm = async () => {
    setSubmitting(true);
    try {
      await onConfirm(reason.trim() || undefined);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(8px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-[480px] rounded-[24px] p-6 sm:p-8"
        style={{
          background: 'rgba(20,20,30,.95)',
          border: '1px solid rgba(255,255,255,.08)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold" style={{ color: '#f4f4f5' }}>
            Отклонить заявку
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:bg-white/5"
            style={{ color: '#a1a1aa' }}
          >
            ✕
          </button>
        </div>

        <p className="text-sm mb-4" style={{ color: '#a1a1aa' }}>
          Сумма {formatRub(payout.amount)} вернётся в доступный баланс
          партнёра. Действие необратимо.
        </p>

        <div className="mb-5">
          <label
            className="block text-xs uppercase tracking-widest mb-2"
            style={{ color: '#71717a' }}
          >
            Причина отказа (опционально)
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, 500))}
            rows={4}
            placeholder="Например: реквизиты не подтверждены"
            className="w-full px-4 py-3 rounded-xl outline-none transition-all resize-y"
            style={{
              background: 'rgba(255,255,255,.03)',
              border: '1px solid rgba(255,255,255,.08)',
              color: '#f4f4f5',
            }}
          />
          <div
            className="mt-1 text-right text-[11px] tabular-nums"
            style={{ color: '#71717a' }}
          >
            {reason.length} / 500
          </div>
        </div>

        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2.5 rounded-xl text-sm font-medium disabled:opacity-50"
            style={{
              background: 'rgba(255,255,255,.04)',
              border: '1px solid rgba(255,255,255,.08)',
              color: '#cbd5e1',
            }}
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={submitting}
            className="px-5 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50"
            style={{
              background: 'rgba(239,68,68,.18)',
              border: '1px solid rgba(239,68,68,.3)',
              color: '#fecaca',
            }}
          >
            {submitting ? 'Отклоняем…' : 'Отклонить'}
          </button>
        </div>
      </div>
    </div>
  );
}
