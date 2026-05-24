'use client';

/**
 * Admin · Partner Applications page (Task 17.1, Requirement 5.1–5.7).
 *
 * Lists every Partner_Application with a status filter; lets the Owner
 * approve (with rate inputs + optional username/promo code overrides)
 * or reject pending applications. After a successful approve, a
 * follow-up modal surfaces the freshly issued promo code and the
 * invite link the admin pastes into Telegram.
 *
 * Auth: relies on `api` axios instance which auto-attaches the
 * `admin_token` Bearer header from localStorage. A failed
 * authorization redirects to /admin/login via the shared interceptor.
 *
 * Visual language matches the rest of `/admin` — dark surface, white/5
 * borders, purple gradient accents.
 */

import { Fragment, useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import { clearAdminSession, getAdminToken, getAdminUser } from '@/lib/auth';

// ─── types mirrored from backend ────────────────────────────────────────

type ApplicationStatus = 'pending' | 'approved' | 'rejected';
type PlatformType =
  | 'telegram'
  | 'vk'
  | 'twitch'
  | 'youtube'
  | 'tiktok'
  | 'other';

interface PartnerApplication {
  id: string;
  displayName: string;
  platformType: PlatformType;
  platformUrl: string;
  audienceSize: string;
  contactTg: string;
  description: string;
  status: ApplicationStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  partnerId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ApprovalResult {
  partner: { id: string; username: string; displayName: string };
  promoCode: string;
  inviteToken: string;
  inviteLink: string;
}

const PLATFORM_LABEL: Record<PlatformType, string> = {
  telegram: 'Telegram-канал',
  vk: 'VK-сообщество',
  twitch: 'Twitch',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  other: 'Другое',
};

const STATUS_TABS: Array<{ value: ApplicationStatus | 'all'; label: string }> = [
  { value: 'all', label: 'Все' },
  { value: 'pending', label: 'На рассмотрении' },
  { value: 'approved', label: 'Одобрено' },
  { value: 'rejected', label: 'Отклонено' },
];

// ─── helpers ────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
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

export default function AdminApplicationsPage() {
  const router = useRouter();
  const [authReady, setAuthReady] = useState(false);

  const [applications, setApplications] = useState<PartnerApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ApplicationStatus | 'all'>(
    'pending',
  );
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [approveTarget, setApproveTarget] = useState<PartnerApplication | null>(
    null,
  );
  const [rejectTarget, setRejectTarget] = useState<PartnerApplication | null>(
    null,
  );
  const [approvalResult, setApprovalResult] = useState<ApprovalResult | null>(
    null,
  );

  // Auth gate — same pattern as /admin/page.tsx.
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

  // Fetch list when the active tab changes.
  useEffect(() => {
    if (!authReady) return;
    let cancelled = false;
    const fetchList = async () => {
      setLoading(true);
      setError(null);
      try {
        const params = activeTab === 'all' ? undefined : { status: activeTab };
        const response = await api.get('/admin/partner-applications', {
          params,
        });
        if (!cancelled) {
          setApplications(response.data?.data ?? []);
        }
      } catch (err) {
        if (!cancelled) {
          setError(extractApiError(err, 'Не удалось загрузить заявки'));
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
    const all = applications.length;
    const byStatus = applications.reduce<Record<ApplicationStatus, number>>(
      (acc, app) => {
        acc[app.status] = (acc[app.status] ?? 0) + 1;
        return acc;
      },
      { pending: 0, approved: 0, rejected: 0 },
    );
    return { all, ...byStatus };
  }, [applications]);

  const handleReject = async (id: string) => {
    try {
      await api.post(`/admin/partner-applications/${id}/reject`);
      // Optimistically refetch the current tab.
      setApplications((prev) =>
        prev.map((a) =>
          a.id === id
            ? { ...a, status: 'rejected', reviewedAt: new Date().toISOString() }
            : a,
        ),
      );
      setRejectTarget(null);
    } catch (err) {
      alert(extractApiError(err, 'Не удалось отклонить заявку'));
    }
  };

  const handleApproveSuccess = (result: ApprovalResult) => {
    setApproveTarget(null);
    setApprovalResult(result);
    // Mark the row approved in-place so the list is consistent without
    // a full refetch.
    setApplications((prev) =>
      prev.map((a) =>
        a.id === result.partner.id ||
        a.partnerId === result.partner.id ||
        approveTarget?.id === a.id
          ? { ...a, status: 'approved', partnerId: result.partner.id }
          : a,
      ),
    );
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
      <AdminHeader />

      <main className="p-4 sm:p-9 max-w-[1400px] mx-auto">
        <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-2xl font-bold" style={{ color: '#f4f4f5' }}>
            Заявки партнёров
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
                : counts[tab.value as ApplicationStatus];
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
          ) : applications.length === 0 ? (
            <div className="p-8 text-center" style={{ color: '#71717a' }}>
              Заявок нет.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px]">
                <thead>
                  <tr style={{ background: 'rgba(255,255,255,.02)' }}>
                    {[
                      'Дата',
                      'Имя',
                      'Площадка',
                      'Аудитория',
                      'Контакт',
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
                  {applications.map((app) => {
                    const expanded = expandedId === app.id;
                    return (
                      <Fragment key={app.id}>
                        <tr
                          className="cursor-pointer transition-all hover:bg-white/5"
                          style={{
                            borderBottom: '1px solid rgba(255,255,255,.04)',
                          }}
                          onClick={() =>
                            setExpandedId((prev) =>
                              prev === app.id ? null : app.id,
                            )
                          }
                        >
                          <td className="px-5 py-4 text-sm whitespace-nowrap" style={{ color: '#a1a1aa' }}>
                            {formatDate(app.createdAt)}
                          </td>
                          <td className="px-5 py-4 text-sm font-medium" style={{ color: '#f4f4f5' }}>
                            {app.displayName}
                          </td>
                          <td className="px-5 py-4 text-sm" style={{ color: '#a1a1aa' }}>
                            {PLATFORM_LABEL[app.platformType]}
                          </td>
                          <td className="px-5 py-4 text-sm" style={{ color: '#a1a1aa' }}>
                            {app.audienceSize}
                          </td>
                          <td className="px-5 py-4 text-sm font-mono" style={{ color: '#a1a1aa' }}>
                            {app.contactTg}
                          </td>
                          <td className="px-5 py-4">
                            <ApplicationStatusBadge status={app.status} />
                          </td>
                          <td
                            className="px-5 py-4"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {app.status === 'pending' ? (
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => setApproveTarget(app)}
                                  className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
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
                                  onClick={() => setRejectTarget(app)}
                                  className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
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
                              <span className="text-xs" style={{ color: '#71717a' }}>
                                {app.reviewedAt ? formatDate(app.reviewedAt) : '—'}
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
                                    Ссылка на площадку
                                  </div>
                                  <a
                                    href={app.platformUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-purple-400 hover:underline break-all"
                                  >
                                    {app.platformUrl}
                                  </a>
                                </div>
                                <div>
                                  <div
                                    className="text-xs uppercase tracking-widest mb-1.5"
                                    style={{ color: '#71717a' }}
                                  >
                                    Описание аудитории
                                  </div>
                                  <p
                                    className="whitespace-pre-wrap"
                                    style={{ color: '#cbd5e1' }}
                                  >
                                    {app.description}
                                  </p>
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

      {approveTarget && (
        <ApproveModal
          application={approveTarget}
          onClose={() => setApproveTarget(null)}
          onSuccess={handleApproveSuccess}
        />
      )}
      {rejectTarget && (
        <RejectConfirm
          application={rejectTarget}
          onClose={() => setRejectTarget(null)}
          onConfirm={() => handleReject(rejectTarget.id)}
        />
      )}
      {approvalResult && (
        <ApprovalResultModal
          result={approvalResult}
          onClose={() => setApprovalResult(null)}
        />
      )}
    </div>
  );
}

// ─── shared header for admin sub-pages ──────────────────────────────────

function AdminHeader() {
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
        <Link
          href="/admin/applications"
          className="px-3 py-2 rounded-lg transition-colors"
          style={{ color: '#a78bfa', background: 'rgba(139,92,246,.1)' }}
        >
          Заявки
        </Link>
        <Link
          href="/admin/partners"
          className="px-3 py-2 rounded-lg transition-colors hover:bg-white/5"
          style={{ color: '#a1a1aa' }}
        >
          Партнёры
        </Link>
        <Link
          href="/admin/payouts"
          className="px-3 py-2 rounded-lg transition-colors hover:bg-white/5"
          style={{ color: '#a1a1aa' }}
        >
          Выплаты
        </Link>
      </nav>
    </header>
  );
}

// ─── status badge ───────────────────────────────────────────────────────

function ApplicationStatusBadge({ status }: { status: ApplicationStatus }) {
  const styles: Record<ApplicationStatus, { bg: string; color: string; label: string }> = {
    pending: { bg: 'rgba(234,179,8,.12)', color: '#eab308', label: 'На рассмотрении' },
    approved: { bg: 'rgba(34,197,94,.12)', color: '#22c55e', label: 'Одобрено' },
    rejected: { bg: 'rgba(239,68,68,.12)', color: '#ef4444', label: 'Отклонено' },
  };
  const s = styles[status];
  return (
    <span
      className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap"
      style={{ background: s.bg, color: s.color }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{ background: s.color }}
      />
      {s.label}
    </span>
  );
}

// ─── approve modal ──────────────────────────────────────────────────────

interface ApproveModalProps {
  application: PartnerApplication;
  onClose: () => void;
  onSuccess: (result: ApprovalResult) => void;
}

function ApproveModal({ application, onClose, onSuccess }: ApproveModalProps) {
  // Inputs hold percentages (0-100) so the field semantics match the
  // labels. We divide by 100 right before posting since the backend DTO
  // expects fractions in [0..1].
  const [discountRate, setDiscountRate] = useState('5');
  const [commissionRate, setCommissionRate] = useState('10');
  const [username, setUsername] = useState('');
  const [promoCode, setPromoCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const dRate = Number(discountRate);
  const cRate = Number(commissionRate);
  const ratesValid =
    Number.isFinite(dRate) &&
    Number.isFinite(cRate) &&
    dRate >= 0 &&
    cRate >= 0 &&
    dRate <= 100 &&
    cRate <= 100;
  const sumExceeds = ratesValid && dRate + cRate > 100;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!ratesValid) {
      setErr('Проценты должны быть в диапазоне 0..100');
      return;
    }
    if (sumExceeds) {
      setErr('Сумма скидки и комиссии не должна превышать 100%');
      return;
    }
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        discountRate: dRate / 100,
        commissionRate: cRate / 100,
      };
      if (username.trim()) body.username = username.trim();
      if (promoCode.trim()) body.promoCode = promoCode.trim().toUpperCase();
      const response = await api.post(
        `/admin/partner-applications/${application.id}/approve`,
        body,
      );
      onSuccess(response.data?.data as ApprovalResult);
    } catch (e2) {
      setErr(extractApiError(e2, 'Не удалось одобрить заявку'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalShell title="Одобрить заявку" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="text-sm" style={{ color: '#a1a1aa' }}>
          Партнёр: <span className="font-semibold text-white">{application.displayName}</span>
          {' · '}
          {PLATFORM_LABEL[application.platformType]}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <NumberRateField
            label="% скидки покупателю"
            value={discountRate}
            onChange={setDiscountRate}
            placeholder="5"
          />
          <NumberRateField
            label="% комиссии партнёру"
            value={commissionRate}
            onChange={setCommissionRate}
            placeholder="10"
          />
        </div>

        <div
          className="text-xs leading-relaxed"
          style={{ color: sumExceeds ? '#fca5a5' : '#71717a' }}
        >
          Сумма скидки и комиссии не должна превышать 100%.
          {ratesValid && (
            <span className="ml-1">
              Сейчас: {(dRate + cRate).toFixed(1)}%
            </span>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <TextField
            label="Логин (опционально)"
            value={username}
            onChange={setUsername}
            placeholder="auto-derived"
          />
          <TextField
            label="Промокод (опционально)"
            value={promoCode}
            onChange={(v) => setPromoCode(v.toUpperCase())}
            placeholder="auto-generated"
          />
        </div>

        {err && (
          <div
            className="p-3 rounded-lg text-sm"
            style={{
              background: 'rgba(239,68,68,.12)',
              border: '1px solid rgba(239,68,68,.3)',
              color: '#fecaca',
            }}
          >
            {err}
          </div>
        )}

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2.5 rounded-xl text-sm font-medium transition-all disabled:opacity-50"
            style={{
              background: 'rgba(255,255,255,.04)',
              border: '1px solid rgba(255,255,255,.08)',
              color: '#cbd5e1',
            }}
          >
            Отмена
          </button>
          <button
            type="submit"
            disabled={submitting || !ratesValid || sumExceeds}
            className="px-5 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-50"
            style={{
              background: 'linear-gradient(135deg,#8b5cf6,#7c3aed)',
              color: 'white',
              boxShadow: '0 4px 20px rgba(139,92,246,.4)',
            }}
          >
            {submitting ? 'Одобряем…' : 'Одобрить и создать партнёра'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

// ─── reject confirm ─────────────────────────────────────────────────────

function RejectConfirm({
  application,
  onClose,
  onConfirm,
}: {
  application: PartnerApplication;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <ModalShell title="Отклонить заявку" onClose={onClose}>
      <p className="text-sm mb-6" style={{ color: '#a1a1aa' }}>
        Заявка <span className="font-semibold text-white">{application.displayName}</span> будет
        переведена в статус «Отклонено». Партнёр не будет создан, действие необратимо.
      </p>
      <div className="flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2.5 rounded-xl text-sm font-medium"
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
          onClick={onConfirm}
          className="px-5 py-2.5 rounded-xl text-sm font-semibold"
          style={{
            background: 'rgba(239,68,68,.18)',
            border: '1px solid rgba(239,68,68,.3)',
            color: '#fecaca',
          }}
        >
          Отклонить
        </button>
      </div>
    </ModalShell>
  );
}

// ─── approval result modal ──────────────────────────────────────────────

function ApprovalResultModal({
  result,
  onClose,
}: {
  result: ApprovalResult;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState<'link' | 'code' | null>(null);
  const handleCopy = async (text: string, kind: 'link' | 'code') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      /* ignore */
    }
  };

  return (
    <ModalShell title="Партнёр создан" onClose={onClose}>
      <div className="space-y-5">
        <div
          className="rounded-xl p-4"
          style={{
            background: 'rgba(34,197,94,.08)',
            border: '1px solid rgba(34,197,94,.25)',
          }}
        >
          <div className="text-xs uppercase tracking-widest mb-1" style={{ color: '#22c55e' }}>
            Партнёр
          </div>
          <div className="font-semibold" style={{ color: '#f4f4f5' }}>
            {result.partner.displayName}
          </div>
          <div className="text-xs mt-1" style={{ color: '#71717a' }}>
            Логин: <span className="font-mono">{result.partner.username}</span>
          </div>
        </div>

        <div>
          <div className="text-xs uppercase tracking-widest mb-2" style={{ color: '#71717a' }}>
            Промокод
          </div>
          <div className="flex items-center gap-2">
            <span
              className="flex-1 font-mono text-lg font-bold tracking-wider px-4 py-3 rounded-xl"
              style={{
                background: 'rgba(139,92,246,.1)',
                border: '1px solid rgba(139,92,246,.25)',
                color: '#c4b5fd',
              }}
            >
              {result.promoCode}
            </span>
            <button
              type="button"
              onClick={() => handleCopy(result.promoCode, 'code')}
              className="px-3 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap"
              style={{
                background:
                  copied === 'code' ? '#22c55e' : 'rgba(255,255,255,.06)',
                border:
                  copied === 'code'
                    ? '1px solid #22c55e'
                    : '1px solid rgba(255,255,255,.08)',
                color: copied === 'code' ? 'white' : '#f4f4f5',
              }}
            >
              {copied === 'code' ? 'Скопировано' : 'Копировать'}
            </button>
          </div>
        </div>

        <div>
          <div className="text-xs uppercase tracking-widest mb-2" style={{ color: '#71717a' }}>
            Invite-ссылка для партнёра
          </div>
          <div className="flex items-center gap-2">
            <span
              className="flex-1 font-mono text-xs px-4 py-3 rounded-xl truncate"
              style={{
                background: 'rgba(255,255,255,.03)',
                border: '1px solid rgba(255,255,255,.08)',
                color: '#a1a1aa',
              }}
            >
              {result.inviteLink}
            </span>
            <button
              type="button"
              onClick={() => handleCopy(result.inviteLink, 'link')}
              className="px-3 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap"
              style={{
                background:
                  copied === 'link' ? '#22c55e' : 'rgba(255,255,255,.06)',
                border:
                  copied === 'link'
                    ? '1px solid #22c55e'
                    : '1px solid rgba(255,255,255,.08)',
                color: copied === 'link' ? 'white' : '#f4f4f5',
              }}
            >
              {copied === 'link' ? 'Скопировано' : 'Скопировать ссылку'}
            </button>
          </div>
          <p className="text-xs mt-2" style={{ color: '#71717a' }}>
            Отправьте ссылку партнёру в Telegram. Партнёр перейдёт по ней и установит пароль для входа в кабинет.
          </p>
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl text-sm font-semibold"
            style={{
              background: 'linear-gradient(135deg,#8b5cf6,#7c3aed)',
              color: 'white',
            }}
          >
            Готово
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

// ─── small reusable bits ────────────────────────────────────────────────

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(8px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-[560px] rounded-[24px] p-6 sm:p-8 max-h-[90vh] overflow-y-auto"
        style={{
          background: 'rgba(20,20,30,.95)',
          border: '1px solid rgba(255,255,255,.08)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold" style={{ color: '#f4f4f5' }}>
            {title}
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
        {children}
      </div>
    </div>
  );
}

function NumberRateField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label
        className="block text-xs uppercase tracking-widest mb-2"
        style={{ color: '#71717a' }}
      >
        {label}
      </label>
      <input
        type="number"
        step="0.5"
        min="0"
        max="100"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-4 py-3 rounded-xl outline-none transition-all"
        style={{
          background: 'rgba(255,255,255,.03)',
          border: '1px solid rgba(255,255,255,.08)',
          color: '#f4f4f5',
        }}
      />
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label
        className="block text-xs uppercase tracking-widest mb-2"
        style={{ color: '#71717a' }}
      >
        {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-4 py-3 rounded-xl outline-none transition-all font-mono text-sm"
        style={{
          background: 'rgba(255,255,255,.03)',
          border: '1px solid rgba(255,255,255,.08)',
          color: '#f4f4f5',
        }}
      />
    </div>
  );
}