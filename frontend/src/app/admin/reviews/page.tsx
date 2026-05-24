'use client';

/**
 * Admin · Order Reviews moderation page (Task 13.1–13.4, Requirement 9 + 10).
 *
 * Lists every Order_Review with a status filter and exposes the two
 * moderation actions:
 *   - «✓ Одобрить» → POST /api/admin/reviews/:id/approve (status=approved)
 *   - «✕ Отклонить» → POST /api/admin/reviews/:id/reject  (status=rejected,
 *      with an optional plain-text rejection reason, max 500 chars)
 *
 * Rows are click-to-expand to reveal the full review text (the table
 * shows a 80-char preview by default to keep rows scannable).
 *
 * The admin endpoint is allowed to surface the orderId (Requirement 9.4)
 * — that is the difference from the public Reviews_API which strips it.
 *
 * Auth: shared `api` axios client auto-attaches `admin_token` Bearer.
 */

import { Fragment, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { reviewsApi, type AdminReview } from '@/lib/api';
import { clearAdminSession, getAdminToken, getAdminUser } from '@/lib/auth';

// ─── types ──────────────────────────────────────────────────────────────

type ReviewStatus = 'pending' | 'approved' | 'rejected';

const STATUS_TABS: Array<{ value: ReviewStatus | 'all'; label: string }> = [
  { value: 'all', label: 'Все' },
  { value: 'pending', label: 'На модерации' },
  { value: 'approved', label: 'Одобрено' },
  { value: 'rejected', label: 'Отклонено' },
];

const TEXT_PREVIEW_LIMIT = 80;

// ─── helpers ────────────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

function renderStars(stars: number): string {
  const safe = Math.max(0, Math.min(5, Math.round(stars)));
  return '★'.repeat(safe) + '☆'.repeat(5 - safe);
}

function truncate(s: string, n: number): { preview: string; truncated: boolean } {
  if (s.length <= n) return { preview: s, truncated: false };
  return { preview: s.slice(0, n).trimEnd() + '…', truncated: true };
}

function extractApiError(err: unknown, fallback: string): string {
  const data = (err as { response?: { data?: { message?: string | string[] } } })
    ?.response?.data;
  if (Array.isArray(data?.message)) return data.message[0] ?? fallback;
  if (typeof data?.message === 'string') return data.message;
  return fallback;
}

// ─── component ──────────────────────────────────────────────────────────

export default function AdminReviewsPage() {
  const router = useRouter();
  const [authReady, setAuthReady] = useState(false);

  const [reviews, setReviews] = useState<AdminReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ReviewStatus | 'all'>('pending');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [rejectTarget, setRejectTarget] = useState<AdminReview | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);

  // Auth gate — mirrors the other partner-program admin pages.
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

  // Fetch list whenever the active tab changes.
  useEffect(() => {
    if (!authReady) return;
    let cancelled = false;
    const fetchList = async () => {
      setLoading(true);
      setError(null);
      try {
        const status = activeTab === 'all' ? undefined : activeTab;
        const response = await reviewsApi.listAdmin(status);
        if (!cancelled) {
          setReviews(response.data ?? []);
        }
      } catch (err) {
        if (!cancelled) {
          setError(extractApiError(err, 'Не удалось загрузить отзывы'));
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
    const by: Record<ReviewStatus, number> = {
      pending: 0,
      approved: 0,
      rejected: 0,
    };
    for (const r of reviews) by[r.status] += 1;
    return { all: reviews.length, ...by };
  }, [reviews]);

  const handleApprove = async (review: AdminReview) => {
    setActingId(review.id);
    try {
      const response = await reviewsApi.approve(review.id);
      const updated = response.data;
      setReviews((prev) =>
        prev.map((r) => (r.id === review.id ? { ...r, ...updated } : r)),
      );
    } catch (err) {
      alert(extractApiError(err, 'Не удалось одобрить отзыв'));
    } finally {
      setActingId(null);
    }
  };

  const handleReject = async (review: AdminReview, reason?: string) => {
    setActingId(review.id);
    try {
      const response = await reviewsApi.reject(review.id, reason);
      const updated = response.data;
      setReviews((prev) =>
        prev.map((r) => (r.id === review.id ? { ...r, ...updated } : r)),
      );
      setRejectTarget(null);
    } catch (err) {
      alert(extractApiError(err, 'Не удалось отклонить отзыв'));
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
      <AdminHeader active="reviews" />

      <main className="p-4 sm:p-9 max-w-[1400px] mx-auto">
        <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-2xl font-bold" style={{ color: '#f4f4f5' }}>
            Отзывы
          </h1>
          <Link
            href="/admin"
            className="text-sm transition-colors hover:text-white"
            style={{ color: '#71717a' }}
          >
            ← К панели
          </Link>
        </div>

        {/* Tabs */}
        <div
          className="flex gap-1 mb-6 overflow-x-auto"
          style={{ borderBottom: '1px solid rgba(255,255,255,.06)' }}
        >
          {STATUS_TABS.map((tab) => {
            const active = activeTab === tab.value;
            const count =
              tab.value === 'all'
                ? counts.all
                : counts[tab.value as ReviewStatus];
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
          ) : reviews.length === 0 ? (
            <div className="p-8 text-center" style={{ color: '#71717a' }}>
              Отзывов нет.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1080px]">
                <thead>
                  <tr style={{ background: 'rgba(255,255,255,.02)' }}>
                    {[
                      'Дата',
                      'Никнейм',
                      'Звёзды',
                      'Текст',
                      'Заказ ID',
                      'Статус',
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
                  {reviews.map((r) => {
                    const expanded = expandedId === r.id;
                    const acting = actingId === r.id;
                    const { preview, truncated } = truncate(
                      r.text,
                      TEXT_PREVIEW_LIMIT,
                    );
                    return (
                      <Fragment key={r.id}>
                        <tr
                          className="cursor-pointer transition-all hover:bg-white/5"
                          style={{
                            borderBottom: '1px solid rgba(255,255,255,.04)',
                          }}
                          onClick={() =>
                            setExpandedId((prev) =>
                              prev === r.id ? null : r.id,
                            )
                          }
                        >
                          <td
                            className="px-5 py-4 text-sm whitespace-nowrap"
                            style={{ color: '#a1a1aa' }}
                          >
                            {formatDate(r.createdAt)}
                          </td>
                          <td
                            className="px-5 py-4 text-sm font-medium"
                            style={{ color: '#f4f4f5' }}
                          >
                            {r.nickname}
                          </td>
                          <td
                            className="px-5 py-4 text-sm whitespace-nowrap font-mono tracking-wider"
                            style={{ color: '#fbbf24' }}
                            aria-label={`${r.stars} из 5`}
                            title={`${r.stars} / 5`}
                          >
                            {renderStars(r.stars)}
                          </td>
                          <td
                            className="px-5 py-4 text-sm max-w-[420px]"
                            style={{ color: '#cbd5e1' }}
                          >
                            <span className="block">{preview}</span>
                            {truncated && (
                              <span
                                className="text-xs"
                                style={{ color: '#71717a' }}
                              >
                                {expanded ? 'Свернуть' : 'Развернуть'}
                              </span>
                            )}
                          </td>
                          <td
                            className="px-5 py-4"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <span
                              className="inline-block px-2 py-1 rounded-md text-[11px] font-mono"
                              style={{
                                background: 'rgba(255,255,255,.04)',
                                border: '1px solid rgba(255,255,255,.08)',
                                color: '#a1a1aa',
                                maxWidth: 180,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                              title={r.orderId}
                            >
                              {r.orderId}
                            </span>
                          </td>
                          <td className="px-5 py-4">
                            <ReviewStatusBadge status={r.status} />
                          </td>
                          <td
                            className="px-5 py-4"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {r.status === 'pending' ? (
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleApprove(r)}
                                  disabled={acting}
                                  className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all disabled:opacity-50"
                                  style={{
                                    background: 'rgba(34,197,94,.15)',
                                    border: '1px solid rgba(34,197,94,.3)',
                                    color: '#22c55e',
                                  }}
                                >
                                  ✓ Одобрить
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setRejectTarget(r)}
                                  disabled={acting}
                                  className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all disabled:opacity-50"
                                  style={{
                                    background: 'rgba(239,68,68,.12)',
                                    border: '1px solid rgba(239,68,68,.3)',
                                    color: '#ef4444',
                                  }}
                                >
                                  ✕ Отклонить
                                </button>
                              </div>
                            ) : (
                              <span
                                className="text-xs"
                                style={{ color: '#71717a' }}
                              >
                                {r.status === 'approved'
                                  ? formatDate(r.approvedAt)
                                  : formatDate(r.rejectedAt)}
                              </span>
                            )}
                          </td>
                        </tr>
                        {expanded && (
                          <tr style={{ background: 'rgba(255,255,255,.015)' }}>
                            <td colSpan={7} className="px-5 py-5">
                              <div className="grid gap-4 md:grid-cols-2 text-sm">
                                <div>
                                  <div
                                    className="text-xs uppercase tracking-widest mb-1.5"
                                    style={{ color: '#71717a' }}
                                  >
                                    Полный текст отзыва
                                  </div>
                                  <p
                                    className="whitespace-pre-wrap leading-relaxed"
                                    style={{ color: '#cbd5e1' }}
                                  >
                                    {r.text}
                                  </p>
                                </div>
                                <div className="space-y-2">
                                  <div className="flex justify-between text-xs">
                                    <span style={{ color: '#71717a' }}>
                                      Создан
                                    </span>
                                    <span style={{ color: '#a1a1aa' }}>
                                      {formatDate(r.createdAt)}
                                    </span>
                                  </div>
                                  {r.approvedAt && (
                                    <div className="flex justify-between text-xs">
                                      <span style={{ color: '#71717a' }}>
                                        Одобрен
                                      </span>
                                      <span style={{ color: '#22c55e' }}>
                                        {formatDate(r.approvedAt)}
                                      </span>
                                    </div>
                                  )}
                                  {r.rejectedAt && (
                                    <div className="flex justify-between text-xs">
                                      <span style={{ color: '#71717a' }}>
                                        Отклонён
                                      </span>
                                      <span style={{ color: '#ef4444' }}>
                                        {formatDate(r.rejectedAt)}
                                      </span>
                                    </div>
                                  )}
                                  <div className="flex justify-between text-xs">
                                    <span style={{ color: '#71717a' }}>
                                      Заказ ID
                                    </span>
                                    <span
                                      className="font-mono"
                                      style={{ color: '#a1a1aa' }}
                                    >
                                      {r.orderId}
                                    </span>
                                  </div>
                                  {r.rejectionReason && (
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
                                        {r.rejectionReason}
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
          review={rejectTarget}
          onClose={() => setRejectTarget(null)}
          onConfirm={(reason) => handleReject(rejectTarget, reason)}
        />
      )}
    </div>
  );
}

// ─── shared header ──────────────────────────────────────────────────────

function AdminHeader({
  active,
}: {
  active: 'applications' | 'partners' | 'payouts' | 'reviews';
}) {
  const items = [
    { key: 'applications', label: 'Заявки', href: '/admin/applications' },
    { key: 'partners', label: 'Партнёры', href: '/admin/partners' },
    { key: 'payouts', label: 'Выплаты', href: '/admin/payouts' },
    { key: 'reviews', label: 'Отзывы', href: '/admin/reviews' },
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
        <span
          className="font-bold text-base truncate"
          style={{ color: '#f4f4f5' }}
        >
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

function ReviewStatusBadge({ status }: { status: ReviewStatus }) {
  const styles: Record<
    ReviewStatus,
    { bg: string; color: string; label: string }
  > = {
    pending: {
      bg: 'rgba(234,179,8,.12)',
      color: '#eab308',
      label: 'На модерации',
    },
    approved: {
      bg: 'rgba(34,197,94,.12)',
      color: '#22c55e',
      label: 'Одобрено',
    },
    rejected: {
      bg: 'rgba(239,68,68,.12)',
      color: '#ef4444',
      label: 'Отклонено',
    },
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

// ─── reject dialog ──────────────────────────────────────────────────────

function RejectDialog({
  review,
  onClose,
  onConfirm,
}: {
  review: AdminReview;
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
            Отклонить отзыв
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
          Отзыв от{' '}
          <span className="font-semibold text-white">{review.nickname}</span>{' '}
          будет переведён в статус «Отклонено» и не появится в публичной
          карусели. Запись сохранится для аудита.
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
            placeholder="Например: оскорбительная лексика"
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
