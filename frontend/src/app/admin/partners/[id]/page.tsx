'use client';

/**
 * Admin · Partner detail page (Task 17.3, Requirement 7.2–7.8, 15.1–15.4).
 *
 * One-stop dashboard for a single partner. Sections:
 *   1. Header: display name, login, status badge, back link.
 *   2. Quick stats: Partner_Balance, Pending_Balance, Total_Earned, Total_Paid.
 *   3. Promo code & rates panel: copy/regenerate code, inline-edit
 *      rates, toggle status.
 *   4. Invite link panel: regenerate token + copy link.
 *   5. Orders table (paginated).
 *   6. Payouts table.
 *
 * Endpoints consumed:
 *   - GET    /admin/partners/:id              — partner row + merged stats
 *   - PATCH  /admin/partners/:id              — update rates / status
 *   - POST   /admin/partners/:id/toggle-status
 *   - POST   /admin/partners/:id/regenerate-code
 *   - POST   /admin/partners/:id/regenerate-invite
 *   - GET    /admin/partners/:id/orders?limit&offset
 *   - GET    /admin/partners/:id/payouts
 */

import {
  Fragment,
  useCallback,
  useEffect,
  useState,
} from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import api from '@/lib/api';
import { clearAdminSession, getAdminToken, getAdminUser } from '@/lib/auth';

// ─── types ──────────────────────────────────────────────────────────────

type PartnerStatus = 'active' | 'disabled';
type CommissionStatus = 'pending' | 'approved' | 'cancelled';
type PayoutStatus = 'requested' | 'processing' | 'paid' | 'rejected';

interface PartnerDetail {
  id: string;
  username: string;
  displayName: string;
  contactTg: string;
  status: PartnerStatus;
  discountRate: number | string;
  commissionRate: number | string;
  createdAt: string;
  // merged stats
  partnerBalance: number;
  pendingBalance: number;
  totalEarned: number;
  totalPaid: number;
  totalOrders: number;
  pendingOrders: number;
  approvedOrders: number;
  cancelledOrders: number;
  currentPromoCode: string | null;
}

interface PartnerOrderRow {
  id: string;
  orderId: string;
  vbucksAmount: number;
  priceTRY: number;
  status: string;
  createdAt: string;
  completedAt: string | null;
  promoCodeSnapshot: string | null;
  discountRateSnapshot: number | string | null;
  commissionRateSnapshot: number | string | null;
  discountAmount: number | string | null;
  commission: {
    id: string;
    amount: number;
    status: CommissionStatus;
    approvedAt: string | null;
    cancelledAt: string | null;
  } | null;
}

interface PartnerPayoutRow {
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

// ─── helpers ────────────────────────────────────────────────────────────

const ORDERS_PAGE_SIZE = 25;

function formatRate(rate: number | string | null | undefined): string {
  if (rate === null || rate === undefined) return '—';
  const n = typeof rate === 'number' ? rate : Number(rate);
  if (!Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(1)}%`;
}

function formatRub(amount: number | string | null | undefined): string {
  if (amount === null || amount === undefined) return '—';
  const n = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isFinite(n)) return '—';
  return `${n.toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ₽`;
}

function formatDate(iso: string | null | undefined): string {
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

export default function AdminPartnerDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const partnerId = params?.id;

  const [authReady, setAuthReady] = useState(false);
  const [partner, setPartner] = useState<PartnerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  const [orders, setOrders] = useState<PartnerOrderRow[]>([]);
  const [ordersOffset, setOrdersOffset] = useState(0);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersHasMore, setOrdersHasMore] = useState(false);

  const [payouts, setPayouts] = useState<PartnerPayoutRow[]>([]);
  const [payoutsLoading, setPayoutsLoading] = useState(false);

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

  const fetchPartner = useCallback(async () => {
    if (!partnerId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await api.get(`/admin/partners/${partnerId}`);
      setPartner(response.data?.data as PartnerDetail);
    } catch (err) {
      setError(extractApiError(err, 'Не удалось загрузить партнёра'));
    } finally {
      setLoading(false);
    }
  }, [partnerId]);

  const fetchOrders = useCallback(
    async (offset: number) => {
      if (!partnerId) return;
      setOrdersLoading(true);
      try {
        const response = await api.get(`/admin/partners/${partnerId}/orders`, {
          params: { limit: ORDERS_PAGE_SIZE, offset },
        });
        const data = response.data?.data;
        const items: PartnerOrderRow[] = data?.orders ?? [];
        setOrders((prev) => (offset === 0 ? items : [...prev, ...items]));
        setOrdersHasMore(items.length === ORDERS_PAGE_SIZE);
        setOrdersOffset(offset);
      } catch (err) {
        setActionError(extractApiError(err, 'Не удалось загрузить заказы'));
      } finally {
        setOrdersLoading(false);
      }
    },
    [partnerId],
  );

  const fetchPayouts = useCallback(async () => {
    if (!partnerId) return;
    setPayoutsLoading(true);
    try {
      const response = await api.get(`/admin/partners/${partnerId}/payouts`);
      setPayouts(response.data?.data ?? []);
    } catch (err) {
      setActionError(extractApiError(err, 'Не удалось загрузить выплаты'));
    } finally {
      setPayoutsLoading(false);
    }
  }, [partnerId]);

  useEffect(() => {
    if (!authReady || !partnerId) return;
    void fetchPartner();
    void fetchOrders(0);
    void fetchPayouts();
  }, [authReady, partnerId, fetchPartner, fetchOrders, fetchPayouts]);

  // ── action handlers ────────────────────────────────────────────────

  const handleSaveRates = async (
    next: { discountRate?: number; commissionRate?: number; status?: PartnerStatus },
  ) => {
    if (!partnerId) return;
    setActionError(null);
    try {
      const response = await api.patch(`/admin/partners/${partnerId}`, next);
      // Refetch full detail (stats may have shifted) instead of merging
      // partial data — simpler and we only do this on user action.
      void fetchPartner();
      return response.data?.data;
    } catch (err) {
      setActionError(extractApiError(err, 'Не удалось сохранить'));
      throw err;
    }
  };

  const handleToggleStatus = async () => {
    if (!partnerId) return;
    setActionError(null);
    try {
      await api.post(`/admin/partners/${partnerId}/toggle-status`);
      void fetchPartner();
    } catch (err) {
      setActionError(extractApiError(err, 'Не удалось изменить статус'));
    }
  };

  const handleRegenerateCode = async () => {
    if (!partnerId) return;
    if (!confirm('Сгенерировать новый промокод? Старый перестанет работать.')) {
      return;
    }
    setActionError(null);
    try {
      await api.post(`/admin/partners/${partnerId}/regenerate-code`);
      void fetchPartner();
    } catch (err) {
      setActionError(extractApiError(err, 'Не удалось сгенерировать код'));
    }
  };

  const handleRegenerateInvite = async () => {
    if (!partnerId) return;
    setActionError(null);
    try {
      const response = await api.post(
        `/admin/partners/${partnerId}/regenerate-invite`,
      );
      setInviteLink(response.data?.data?.inviteLink ?? null);
    } catch (err) {
      setActionError(extractApiError(err, 'Не удалось сгенерировать ссылку'));
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
      <AdminHeader active="partners" />
      <main className="p-4 sm:p-9 max-w-[1400px] mx-auto">
        <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
          <Link
            href="/admin/partners"
            className="text-sm transition-colors hover:text-white"
            style={{ color: '#71717a' }}
          >
            ← Назад к списку
          </Link>
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

        {loading && !partner ? (
          <div
            className="p-8 text-center rounded-[24px]"
            style={{
              background: 'rgba(255,255,255,.03)',
              border: '1px solid rgba(255,255,255,.06)',
              color: '#71717a',
            }}
          >
            Загрузка…
          </div>
        ) : partner ? (
          <>
            <PartnerHeader partner={partner} />
            <QuickStats partner={partner} />

            {actionError && (
              <div
                className="p-4 rounded-xl mb-5 text-sm"
                style={{
                  background: 'rgba(239,68,68,.12)',
                  border: '1px solid rgba(239,68,68,.3)',
                  color: '#fecaca',
                }}
              >
                {actionError}
              </div>
            )}

            <div className="grid gap-5 lg:grid-cols-2 mb-6">
              <PromoCodeAndRatesPanel
                partner={partner}
                onSaveRates={handleSaveRates}
                onToggleStatus={handleToggleStatus}
                onRegenerateCode={handleRegenerateCode}
              />
              <InviteLinkPanel
                inviteLink={inviteLink}
                onRegenerate={handleRegenerateInvite}
              />
            </div>

            <OrdersSection
              orders={orders}
              loading={ordersLoading}
              hasMore={ordersHasMore}
              onLoadMore={() => fetchOrders(ordersOffset + ORDERS_PAGE_SIZE)}
            />

            <PayoutsSection payouts={payouts} loading={payoutsLoading} />
          </>
        ) : null}
      </main>
    </div>
  );
}

// ─── header bar ─────────────────────────────────────────────────────────

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

// ─── partner header ─────────────────────────────────────────────────────

function PartnerHeader({ partner }: { partner: PartnerDetail }) {
  return (
    <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: '#f4f4f5' }}>
          {partner.displayName}
        </h1>
        <div className="text-sm mt-1 flex flex-wrap items-center gap-3" style={{ color: '#71717a' }}>
          <span className="font-mono">{partner.username}</span>
          <span>·</span>
          <span>{partner.contactTg}</span>
          <span>·</span>
          <span>создан {formatDate(partner.createdAt)}</span>
        </div>
      </div>
      <PartnerStatusBadge status={partner.status} />
    </div>
  );
}

function PartnerStatusBadge({ status }: { status: PartnerStatus }) {
  const styles: Record<PartnerStatus, { bg: string; color: string; label: string }> = {
    active: { bg: 'rgba(34,197,94,.12)', color: '#22c55e', label: 'Активен' },
    disabled: { bg: 'rgba(113,113,122,.18)', color: '#a1a1aa', label: 'Отключён' },
  };
  const s = styles[status];
  return (
    <span
      className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap"
      style={{ background: s.bg, color: s.color }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: s.color }} />
      {s.label}
    </span>
  );
}

// ─── quick stats ────────────────────────────────────────────────────────

function QuickStats({ partner }: { partner: PartnerDetail }) {
  const cards = [
    {
      label: 'Доступно к выплате',
      value: formatRub(partner.partnerBalance),
      color: '#22c55e',
      bg: 'linear-gradient(135deg, rgba(34,197,94,.15), rgba(34,197,94,.05))',
      border: 'rgba(34,197,94,.2)',
    },
    {
      label: 'В ожидании',
      value: formatRub(partner.pendingBalance),
      color: '#eab308',
      bg: 'linear-gradient(135deg, rgba(234,179,8,.12), rgba(234,179,8,.04))',
      border: 'rgba(234,179,8,.2)',
    },
    {
      label: 'Заработано всего',
      value: formatRub(partner.totalEarned),
      color: '#a78bfa',
      bg: 'linear-gradient(135deg, rgba(139,92,246,.15), rgba(139,92,246,.05))',
      border: 'rgba(139,92,246,.2)',
    },
    {
      label: 'Выплачено',
      value: formatRub(partner.totalPaid),
      color: '#cbd5e1',
      bg: 'rgba(255,255,255,.03)',
      border: 'rgba(255,255,255,.06)',
    },
  ];
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-5 mb-6">
        {cards.map((c) => (
          <div
            key={c.label}
            className="rounded-[20px] p-5"
            style={{ background: c.bg, border: `1px solid ${c.border}` }}
          >
            <div
              className="text-xs uppercase tracking-widest mb-2"
              style={{ color: '#71717a' }}
            >
              {c.label}
            </div>
            <div className="font-mono text-2xl font-bold" style={{ color: c.color }}>
              {c.value}
            </div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-5 mb-6 text-sm">
        <SmallStat label="Заказов всего" value={partner.totalOrders} />
        <SmallStat
          label="Pending"
          value={partner.pendingOrders}
          color="#eab308"
        />
        <SmallStat
          label="Approved"
          value={partner.approvedOrders}
          color="#22c55e"
        />
        <SmallStat
          label="Cancelled"
          value={partner.cancelledOrders}
          color="#ef4444"
        />
      </div>
    </>
  );
}

function SmallStat({
  label,
  value,
  color = '#cbd5e1',
}: {
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div
      className="rounded-xl px-4 py-3 flex items-center justify-between"
      style={{
        background: 'rgba(255,255,255,.025)',
        border: '1px solid rgba(255,255,255,.05)',
      }}
    >
      <span className="text-xs" style={{ color: '#71717a' }}>
        {label}
      </span>
      <span className="font-mono font-bold" style={{ color }}>
        {value}
      </span>
    </div>
  );
}

// ─── promo code & rates panel ───────────────────────────────────────────

function PromoCodeAndRatesPanel({
  partner,
  onSaveRates,
  onToggleStatus,
  onRegenerateCode,
}: {
  partner: PartnerDetail;
  onSaveRates: (next: {
    discountRate?: number;
    commissionRate?: number;
  }) => Promise<unknown>;
  onToggleStatus: () => void;
  onRegenerateCode: () => void;
}) {
  const [editing, setEditing] = useState(false);
  // Inputs hold percentages (0-100). Backend stores fractions in [0..1],
  // so we * 100 on read and / 100 on save. `formatRate` already prints
  // the stored fraction as a percentage in the read-only display.
  const [discountInput, setDiscountInput] = useState(
    String(Number(partner.discountRate ?? 0) * 100),
  );
  const [commissionInput, setCommissionInput] = useState(
    String(Number(partner.commissionRate ?? 0) * 100),
  );
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Sync local edit state when the partner reloads after a save.
  useEffect(() => {
    if (!editing) {
      setDiscountInput(String(Number(partner.discountRate ?? 0) * 100));
      setCommissionInput(String(Number(partner.commissionRate ?? 0) * 100));
    }
  }, [partner.discountRate, partner.commissionRate, editing]);

  const dRate = Number(discountInput);
  const cRate = Number(commissionInput);
  const ratesValid =
    Number.isFinite(dRate) &&
    Number.isFinite(cRate) &&
    dRate >= 0 &&
    cRate >= 0 &&
    dRate <= 100 &&
    cRate <= 100;
  const sumExceeds = ratesValid && dRate + cRate > 100;

  const handleSave = async () => {
    setLocalError(null);
    if (!ratesValid) {
      setLocalError('Проценты должны быть в диапазоне 0..100');
      return;
    }
    if (sumExceeds) {
      setLocalError('Сумма скидки и комиссии не должна превышать 100%');
      return;
    }
    setSaving(true);
    try {
      await onSaveRates({
        discountRate: dRate / 100,
        commissionRate: cRate / 100,
      });
      setEditing(false);
    } catch {
      // already surfaced via parent actionError
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = async () => {
    if (!partner.currentPromoCode) return;
    try {
      await navigator.clipboard.writeText(partner.currentPromoCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* ignore */
    }
  };

  return (
    <section
      className="rounded-[24px] p-6"
      style={{
        background: 'rgba(255,255,255,.03)',
        border: '1px solid rgba(255,255,255,.06)',
      }}
    >
      <h2 className="text-base font-semibold mb-5" style={{ color: '#f4f4f5' }}>
        Промокод и параметры
      </h2>

      {/* promo code */}
      <div className="mb-6">
        <div
          className="text-xs uppercase tracking-widest mb-2"
          style={{ color: '#71717a' }}
        >
          Текущий промокод
        </div>
        <div className="flex items-center gap-2">
          <span
            className="flex-1 font-mono text-xl font-bold tracking-wider px-4 py-3 rounded-xl"
            style={{
              background: 'rgba(139,92,246,.1)',
              border: '1px solid rgba(139,92,246,.25)',
              color: '#c4b5fd',
            }}
          >
            {partner.currentPromoCode ?? '—'}
          </span>
          <button
            type="button"
            onClick={handleCopy}
            disabled={!partner.currentPromoCode}
            className="px-3 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap disabled:opacity-50"
            style={{
              background: copied ? '#22c55e' : 'rgba(255,255,255,.06)',
              border: copied ? '1px solid #22c55e' : '1px solid rgba(255,255,255,.08)',
              color: copied ? 'white' : '#f4f4f5',
            }}
          >
            {copied ? 'Скопировано' : 'Копировать'}
          </button>
          <button
            type="button"
            onClick={onRegenerateCode}
            className="px-3 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap"
            style={{
              background: 'rgba(234,179,8,.12)',
              border: '1px solid rgba(234,179,8,.3)',
              color: '#eab308',
            }}
          >
            Регенерировать
          </button>
        </div>
      </div>

      {/* rates */}
      <div className="grid grid-cols-2 gap-4 mb-5">
        <RateCell
          label="% скидки покупателю"
          editing={editing}
          value={discountInput}
          display={formatRate(partner.discountRate)}
          onChange={setDiscountInput}
        />
        <RateCell
          label="% комиссии партнёру"
          editing={editing}
          value={commissionInput}
          display={formatRate(partner.commissionRate)}
          onChange={setCommissionInput}
        />
      </div>

      {editing && (
        <div
          className="text-xs leading-relaxed mb-3"
          style={{ color: sumExceeds ? '#fca5a5' : '#71717a' }}
        >
          Сумма скидки и комиссии не должна превышать 100%.
          {ratesValid && (
            <span className="ml-1">
              Сейчас: {(dRate + cRate).toFixed(1)}%
            </span>
          )}
        </div>
      )}

      {localError && (
        <div
          className="p-3 rounded-lg text-sm mb-3"
          style={{
            background: 'rgba(239,68,68,.12)',
            border: '1px solid rgba(239,68,68,.3)',
            color: '#fecaca',
          }}
        >
          {localError}
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        {editing ? (
          <>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !ratesValid || sumExceeds}
              className="px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-50"
              style={{
                background: 'linear-gradient(135deg,#8b5cf6,#7c3aed)',
                color: 'white',
              }}
            >
              {saving ? 'Сохранение…' : 'Сохранить'}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setLocalError(null);
                setDiscountInput(String(Number(partner.discountRate ?? 0) * 100));
                setCommissionInput(String(Number(partner.commissionRate ?? 0) * 100));
              }}
              disabled={saving}
              className="px-4 py-2 rounded-xl text-sm font-medium"
              style={{
                background: 'rgba(255,255,255,.04)',
                border: '1px solid rgba(255,255,255,.08)',
                color: '#cbd5e1',
              }}
            >
              Отмена
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="px-4 py-2 rounded-xl text-sm font-medium"
            style={{
              background: 'rgba(255,255,255,.04)',
              border: '1px solid rgba(255,255,255,.08)',
              color: '#cbd5e1',
            }}
          >
            Редактировать ставки
          </button>
        )}
        <button
          type="button"
          onClick={onToggleStatus}
          className="px-4 py-2 rounded-xl text-sm font-medium"
          style={
            partner.status === 'active'
              ? {
                  background: 'rgba(239,68,68,.12)',
                  border: '1px solid rgba(239,68,68,.3)',
                  color: '#ef4444',
                }
              : {
                  background: 'rgba(34,197,94,.12)',
                  border: '1px solid rgba(34,197,94,.3)',
                  color: '#22c55e',
                }
          }
        >
          {partner.status === 'active' ? 'Отключить' : 'Включить'}
        </button>
      </div>
    </section>
  );
}

function RateCell({
  label,
  editing,
  value,
  display,
  onChange,
}: {
  label: string;
  editing: boolean;
  value: string;
  display: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <div
        className="text-xs uppercase tracking-widest mb-2"
        style={{ color: '#71717a' }}
      >
        {label}
      </div>
      {editing ? (
        <input
          type="number"
          step="0.5"
          min="0"
          max="100"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-4 py-3 rounded-xl outline-none transition-all font-mono"
          style={{
            background: 'rgba(255,255,255,.03)',
            border: '1px solid rgba(255,255,255,.08)',
            color: '#f4f4f5',
          }}
        />
      ) : (
        <div
          className="font-mono text-xl font-bold px-4 py-3 rounded-xl"
          style={{
            background: 'rgba(255,255,255,.025)',
            border: '1px solid rgba(255,255,255,.05)',
            color: '#f4f4f5',
          }}
        >
          {display}
        </div>
      )}
    </div>
  );
}

// ─── invite link panel ─────────────────────────────────────────────────

function InviteLinkPanel({
  inviteLink,
  onRegenerate,
}: {
  inviteLink: string | null;
  onRegenerate: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* ignore */
    }
  };

  return (
    <section
      className="rounded-[24px] p-6"
      style={{
        background: 'rgba(255,255,255,.03)',
        border: '1px solid rgba(255,255,255,.06)',
      }}
    >
      <h2 className="text-base font-semibold mb-5" style={{ color: '#f4f4f5' }}>
        Invite-ссылка
      </h2>

      <p className="text-sm mb-4" style={{ color: '#a1a1aa' }}>
        Сгенерируйте новую одноразовую ссылку, по которой партнёр сможет
        задать пароль и войти в кабинет. Старая ссылка перестанет работать.
      </p>

      {inviteLink && (
        <div className="mb-4">
          <div
            className="text-xs uppercase tracking-widest mb-2"
            style={{ color: '#71717a' }}
          >
            Новая ссылка
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
              {inviteLink}
            </span>
            <button
              type="button"
              onClick={handleCopy}
              className="px-3 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap"
              style={{
                background: copied ? '#22c55e' : 'rgba(255,255,255,.06)',
                border: copied
                  ? '1px solid #22c55e'
                  : '1px solid rgba(255,255,255,.08)',
                color: copied ? 'white' : '#f4f4f5',
              }}
            >
              {copied ? 'Скопировано' : 'Скопировать'}
            </button>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={onRegenerate}
        className="px-4 py-2.5 rounded-xl text-sm font-semibold"
        style={{
          background: 'linear-gradient(135deg,#8b5cf6,#7c3aed)',
          color: 'white',
          boxShadow: '0 4px 20px rgba(139,92,246,.3)',
        }}
      >
        {inviteLink
          ? 'Сгенерировать ещё раз'
          : 'Регенерировать invite-ссылку'}
      </button>
    </section>
  );
}

// ─── orders section ─────────────────────────────────────────────────────

function OrdersSection({
  orders,
  loading,
  hasMore,
  onLoadMore,
}: {
  orders: PartnerOrderRow[];
  loading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
}) {
  return (
    <section className="mb-6">
      <h2 className="text-base font-semibold mb-3" style={{ color: '#f4f4f5' }}>
        История заказов
      </h2>
      <div
        className="rounded-[24px] overflow-hidden"
        style={{
          background: 'rgba(255,255,255,.03)',
          border: '1px solid rgba(255,255,255,.06)',
        }}
      >
        {orders.length === 0 && !loading ? (
          <div className="p-8 text-center" style={{ color: '#71717a' }}>
            Заказов нет.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px]">
              <thead>
                <tr style={{ background: 'rgba(255,255,255,.02)' }}>
                  {[
                    'Дата',
                    'ID заказа',
                    'V-Bucks',
                    'Сумма',
                    'Скидка',
                    'Комиссия',
                    'Статус заказа',
                    'Статус комиссии',
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
                {orders.map((o) => (
                  <tr
                    key={o.id}
                    style={{ borderBottom: '1px solid rgba(255,255,255,.04)' }}
                  >
                    <td className="px-5 py-3 text-sm whitespace-nowrap" style={{ color: '#a1a1aa' }}>
                      {formatDate(o.createdAt)}
                    </td>
                    <td className="px-5 py-3 text-sm font-mono" style={{ color: '#71717a' }}>
                      #{o.orderId}
                    </td>
                    <td className="px-5 py-3 text-sm font-mono" style={{ color: '#cbd5e1' }}>
                      {o.vbucksAmount.toLocaleString('ru-RU')}
                    </td>
                    <td className="px-5 py-3 text-sm font-mono" style={{ color: '#f4f4f5' }}>
                      {formatRub(o.priceTRY)}
                    </td>
                    <td className="px-5 py-3 text-sm font-mono" style={{ color: '#a1a1aa' }}>
                      {formatRub(o.discountAmount)}
                    </td>
                    <td className="px-5 py-3 text-sm font-mono" style={{ color: '#22c55e' }}>
                      {o.commission ? formatRub(o.commission.amount) : '—'}
                    </td>
                    <td className="px-5 py-3">
                      <OrderStatusBadge status={o.status} />
                    </td>
                    <td className="px-5 py-3">
                      {o.commission ? (
                        <CommissionStatusBadge status={o.commission.status} />
                      ) : (
                        <span className="text-xs" style={{ color: '#71717a' }}>
                          —
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {(loading || hasMore) && (
          <div
            className="px-5 py-4 flex items-center justify-center"
            style={{ borderTop: '1px solid rgba(255,255,255,.04)' }}
          >
            {loading ? (
              <span className="text-sm" style={{ color: '#71717a' }}>
                Загрузка…
              </span>
            ) : hasMore ? (
              <button
                type="button"
                onClick={onLoadMore}
                className="px-4 py-2 rounded-xl text-sm font-medium"
                style={{
                  background: 'rgba(255,255,255,.04)',
                  border: '1px solid rgba(255,255,255,.08)',
                  color: '#cbd5e1',
                }}
              >
                Загрузить ещё
              </button>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}

function OrderStatusBadge({ status }: { status: string }) {
  const styles: Record<string, { bg: string; color: string; label: string }> = {
    completed: { bg: 'rgba(34,197,94,.12)', color: '#22c55e', label: 'Завершён' },
    failed: { bg: 'rgba(239,68,68,.12)', color: '#ef4444', label: 'Ошибка' },
    cancelled: { bg: 'rgba(239,68,68,.12)', color: '#ef4444', label: 'Отменён' },
    processing: { bg: 'rgba(139,92,246,.12)', color: '#8b5cf6', label: 'В процессе' },
    pending: { bg: 'rgba(234,179,8,.12)', color: '#eab308', label: 'Ожидает' },
    awaiting_auth: { bg: 'rgba(234,179,8,.12)', color: '#eab308', label: 'Ожидает auth' },
    auth_completed: { bg: 'rgba(139,92,246,.12)', color: '#8b5cf6', label: 'Авторизован' },
  };
  const s = styles[status] ?? {
    bg: 'rgba(113,113,122,.18)',
    color: '#a1a1aa',
    label: status,
  };
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

function CommissionStatusBadge({ status }: { status: CommissionStatus }) {
  const styles: Record<CommissionStatus, { bg: string; color: string; label: string }> = {
    pending: { bg: 'rgba(234,179,8,.12)', color: '#eab308', label: 'В ожидании' },
    approved: { bg: 'rgba(34,197,94,.12)', color: '#22c55e', label: 'Одобрена' },
    cancelled: { bg: 'rgba(239,68,68,.12)', color: '#ef4444', label: 'Отменена' },
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

// ─── payouts section ────────────────────────────────────────────────────

function PayoutsSection({
  payouts,
  loading,
}: {
  payouts: PartnerPayoutRow[];
  loading: boolean;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  return (
    <section className="mb-12">
      <h2 className="text-base font-semibold mb-3" style={{ color: '#f4f4f5' }}>
        История выплат
      </h2>
      <div
        className="rounded-[24px] overflow-hidden"
        style={{
          background: 'rgba(255,255,255,.03)',
          border: '1px solid rgba(255,255,255,.06)',
        }}
      >
        {loading ? (
          <div className="p-8 text-center" style={{ color: '#71717a' }}>
            Загрузка…
          </div>
        ) : payouts.length === 0 ? (
          <div className="p-8 text-center" style={{ color: '#71717a' }}>
            Выплат нет.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px]">
              <thead>
                <tr style={{ background: 'rgba(255,255,255,.02)' }}>
                  {[
                    'Дата запроса',
                    'Сумма',
                    'Реквизиты',
                    'Статус',
                    'Дата выплаты',
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
                  const expanded = expandedId === p.id;
                  return (
                    <Fragment key={p.id}>
                      <tr
                        className="cursor-pointer hover:bg-white/5"
                        style={{ borderBottom: '1px solid rgba(255,255,255,.04)' }}
                        onClick={() =>
                          setExpandedId((prev) => (prev === p.id ? null : p.id))
                        }
                      >
                        <td className="px-5 py-3 text-sm whitespace-nowrap" style={{ color: '#a1a1aa' }}>
                          {formatDate(p.requestedAt)}
                        </td>
                        <td className="px-5 py-3 text-sm font-mono font-bold" style={{ color: '#f4f4f5' }}>
                          {formatRub(p.amount)}
                        </td>
                        <td className="px-5 py-3 text-sm" style={{ color: '#a1a1aa' }}>
                          {p.requisites.length > 40
                            ? `${p.requisites.slice(0, 40)}…`
                            : p.requisites}
                        </td>
                        <td className="px-5 py-3">
                          <PayoutStatusBadge status={p.status} />
                        </td>
                        <td className="px-5 py-3 text-sm whitespace-nowrap" style={{ color: '#a1a1aa' }}>
                          {p.paidAt ? formatDate(p.paidAt) : '—'}
                        </td>
                      </tr>
                      {expanded && (
                        <tr style={{ background: 'rgba(255,255,255,.015)' }}>
                          <td colSpan={5} className="px-5 py-4 text-sm">
                            <div className="grid gap-3 md:grid-cols-2">
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
                              {p.rejectionReason && (
                                <div>
                                  <div
                                    className="text-xs uppercase tracking-widest mb-1.5"
                                    style={{ color: '#71717a' }}
                                  >
                                    Причина отказа
                                  </div>
                                  <p style={{ color: '#fecaca' }}>
                                    {p.rejectionReason}
                                  </p>
                                </div>
                              )}
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
    </section>
  );
}

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
